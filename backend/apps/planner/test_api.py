from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.tracking import inference
from apps.tracking.models import StudySessionLog

from .models import Course, StudyPlan
from .tests import FAKE_MODEL


class PlannerApiTests(APITestCase):
    generate_url = "/api/planner/generate/"
    history_url = "/api/planner/history/"

    def setUp(self):
        self.user = User.objects.create_user(username="plannerapi", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def generate(self, hours, courses):
        return self.client.post(
            self.generate_url, {"total_available_hours": hours, "courses": courses}, format="json"
        )

    def hours_by_course(self, response):
        return {item["course"]: item["allocated_hours"] for item in response.data["allocations"]}

    def test_hours_split_by_difficulty_weight(self):
        response = self.generate(
            12,
            [
                {"name": "Easy", "difficulty": 1},
                {"name": "Medium", "difficulty": 2},
                {"name": "Hard", "difficulty": 3},
            ],
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.hours_by_course(response), {"Easy": 2.0, "Medium": 4.0, "Hard": 6.0})

    def test_equal_difficulty_splits_evenly(self):
        response = self.generate(10, [{"name": "A", "difficulty": 3}, {"name": "B", "difficulty": 3}])
        self.assertEqual(self.hours_by_course(response), {"A": 5.0, "B": 5.0})

    def test_allocation_carries_block_lengths(self):
        response = self.generate(10, [{"name": "A", "difficulty": 3}])
        allocation = response.data["allocations"][0]
        self.assertEqual(allocation["focus_block_minutes"], 50)
        self.assertEqual(allocation["break_minutes"], 10)

    def test_allocations_sum_to_total_hours(self):
        cases = [
            (10, [3, 3, 3]),
            (7.5, [1, 2, 5]),
            (20, [4, 1, 3, 2]),
            (1, [2, 3]),
        ]
        for total, difficulties in cases:
            with self.subTest(total=total, difficulties=difficulties):
                courses = [{"name": f"Course {i}", "difficulty": d} for i, d in enumerate(difficulties)]
                response = self.generate(total, courses)
                self.assertEqual(response.status_code, 200)
                allocated = sum(item["allocated_hours"] for item in response.data["allocations"])
                self.assertAlmostEqual(allocated, total, delta=0.05)

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_allocations_still_sum_to_total_after_adherence_adjustment(self, _):
        for name, planned, actual in [("Low", 100, 30), ("High", 100, 100)]:
            StudySessionLog.objects.create(
                user=self.user,
                course_name=name,
                planned_minutes=planned,
                actual_minutes=actual,
                adherence_score=actual / planned,
            )
        response = self.generate(10, [{"name": "Low", "difficulty": 3}, {"name": "High", "difficulty": 3}])
        by_course = {item["course"]: item for item in response.data["allocations"]}
        self.assertEqual(by_course["Low"]["adjustment_source"], "rule")
        self.assertLess(by_course["Low"]["allocated_hours"], by_course["High"]["allocated_hours"])
        allocated = sum(item["allocated_hours"] for item in response.data["allocations"])
        self.assertAlmostEqual(allocated, 10, delta=0.05)

    def test_empty_course_list_returns_400(self):
        response = self.generate(10, [])
        self.assertEqual(response.status_code, 400)
        self.assertIn("courses", response.data)
        self.assertEqual(StudyPlan.objects.count(), 0)

    def test_missing_courses_returns_400(self):
        response = self.client.post(self.generate_url, {"total_available_hours": 10}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("courses", response.data)

    def test_total_hours_below_one_returns_400(self):
        response = self.generate(0.5, [{"name": "A", "difficulty": 3}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("total_available_hours", response.data)

    def test_missing_total_hours_returns_400(self):
        response = self.client.post(self.generate_url, {"courses": [{"name": "A"}]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("total_available_hours", response.data)

    def test_generate_stores_plan_for_caller(self):
        self.generate(10, [{"name": "A", "difficulty": 3}])
        plan = StudyPlan.objects.get()
        self.assertEqual(plan.user, self.user)
        self.assertEqual(plan.week_start.weekday(), 0)  # Monday
        self.assertEqual(plan.plan_json["total_available_hours"], 10.0)
        self.assertEqual(plan.plan_json["allocations"][0]["course"], "A")

    def test_history_is_empty_without_plans(self):
        response = self.client.get(self.history_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"items": []})

    def test_history_returns_only_callers_plans(self):
        other = User.objects.create_user(username="otherplanner", password="TestPass123!")
        StudyPlan.objects.create(user=other, week_start=timezone.localdate(), plan_json={"marker": "other"})
        self.generate(10, [{"name": "A", "difficulty": 3}])
        response = self.client.get(self.history_url)
        self.assertEqual(len(response.data["items"]), 1)
        self.assertNotIn("marker", response.data["items"][0]["plan_json"])
        self.assertEqual(response.data["items"][0]["plan_json"]["allocations"][0]["course"], "A")

    def test_history_is_newest_first(self):
        now = timezone.now()
        for age_days, marker in [(3, "oldest"), (1, "newest"), (2, "middle")]:
            plan = StudyPlan.objects.create(user=self.user, week_start=timezone.localdate(), plan_json={"marker": marker})
            StudyPlan.objects.filter(pk=plan.pk).update(created_at=now - timedelta(days=age_days))
        response = self.client.get(self.history_url)
        self.assertEqual([item["plan_json"]["marker"] for item in response.data["items"]], ["newest", "middle", "oldest"])


class PlannerCourseUpsertTests(APITestCase):
    generate_url = "/api/planner/generate/"

    def setUp(self):
        self.user = User.objects.create_user(username="upsertuser", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def generate(self, courses, hours=10):
        response = self.client.post(
            self.generate_url, {"total_available_hours": hours, "courses": courses}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_generate_creates_course_rows(self):
        self.generate([{"name": "CSC 401", "difficulty": 4}, {"name": "MTH 401", "difficulty": 2}])
        courses = {c.name: c for c in Course.objects.filter(user=self.user)}
        self.assertEqual(set(courses), {"CSC 401", "MTH 401"})
        self.assertEqual(courses["CSC 401"].difficulty, 4)
        self.assertEqual(courses["MTH 401"].difficulty, 2)
        self.assertAlmostEqual(courses["CSC 401"].weekly_target_hours, 6.67, places=2)

    def test_regenerating_updates_the_existing_row(self):
        self.generate([{"name": "CSC 401", "difficulty": 4}])
        first_id = Course.objects.get(user=self.user, name="CSC 401").id
        self.generate([{"name": "CSC 401", "difficulty": 2}], hours=8)
        self.assertEqual(Course.objects.filter(user=self.user, name="CSC 401").count(), 1)
        course = Course.objects.get(user=self.user, name="CSC 401")
        self.assertEqual(course.id, first_id)
        self.assertEqual(course.difficulty, 2)
        self.assertEqual(course.weekly_target_hours, 8.0)

    def test_same_course_name_for_different_users_stays_separate(self):
        other = User.objects.create_user(username="otherupsert", password="TestPass123!")
        self.generate([{"name": "CSC 401", "difficulty": 4}])
        self.client.force_authenticate(user=other)
        self.generate([{"name": "CSC 401", "difficulty": 1}])
        self.assertEqual(Course.objects.filter(name="CSC 401").count(), 2)
        self.assertEqual(Course.objects.get(user=self.user, name="CSC 401").difficulty, 4)
        self.assertEqual(Course.objects.get(user=other, name="CSC 401").difficulty, 1)
