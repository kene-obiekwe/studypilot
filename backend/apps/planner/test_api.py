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

    def test_history_is_one_plan_per_week_newest_week_first(self):
        monday = timezone.localdate() - timedelta(days=timezone.localdate().weekday())
        for weeks_ago, marker in [(2, "oldest"), (0, "newest"), (1, "middle")]:
            StudyPlan.objects.create(
                user=self.user, week_start=monday - timedelta(weeks=weeks_ago), plan_json={"marker": marker}
            )
        StudyPlan.objects.create(
            user=self.user, week_start=monday, plan_json={"marker": "superseded"}, revision=0, is_current=False
        )
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


class PlannerInputValidationTests(APITestCase):
    generate_url = "/api/planner/generate/"

    def setUp(self):
        self.user = User.objects.create_user(username="validation", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def generate(self, courses, hours=10):
        return self.client.post(
            self.generate_url, {"total_available_hours": hours, "courses": courses}, format="json"
        )

    def assert_rejected(self, response, field=None):
        self.assertEqual(response.status_code, 400, response.data)
        if field:
            self.assertIn(field, str(response.data))
        self.assertEqual(StudyPlan.objects.count(), 0)
        self.assertEqual(Course.objects.count(), 0)

    def test_blank_name_rejected(self):
        for name in ("", "   "):
            with self.subTest(name=name):
                self.assert_rejected(self.generate([{"name": name, "difficulty": 3}]), "name")

    def test_missing_name_rejected(self):
        self.assert_rejected(self.generate([{"difficulty": 3}]), "name")

    def test_null_name_rejected(self):
        self.assert_rejected(self.generate([{"name": None, "difficulty": 3}]), "name")

    def test_name_longer_than_120_characters_rejected(self):
        self.assert_rejected(self.generate([{"name": "x" * 121, "difficulty": 3}]), "name")
        self.assertEqual(self.generate([{"name": "x" * 120, "difficulty": 3}]).status_code, 200)

    def test_name_is_trimmed(self):
        response = self.generate([{"name": "  CSC 401  ", "difficulty": 3}])
        self.assertEqual(response.status_code, 200)
        self.assertEqual([a["course"] for a in response.data["allocations"]], ["CSC 401"])
        self.assertEqual(Course.objects.get().name, "CSC 401")
        stored = StudyPlan.objects.get().plan_json["courses"]
        self.assertEqual([(c["name"], c["difficulty"]) for c in stored], [("CSC 401", 3)])

    def test_invalid_difficulty_rejected(self):
        for difficulty in (0, 6, -1, "abc", 3.5, None, [], {}, True):
            with self.subTest(difficulty=difficulty):
                self.assert_rejected(self.generate([{"name": "A", "difficulty": difficulty}]), "difficulty")

    def test_missing_difficulty_rejected(self):
        self.assert_rejected(self.generate([{"name": "A"}]), "difficulty")

    def test_difficulty_bounds_accepted(self):
        response = self.generate([{"name": "Easy", "difficulty": 1}, {"name": "Hard", "difficulty": 5}])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Course.objects.get(name="Easy").difficulty, 1)
        self.assertEqual(Course.objects.get(name="Hard").difficulty, 5)

    def test_course_that_is_not_an_object_rejected(self):
        self.assert_rejected(self.generate(["CSC 401"]))
        self.assert_rejected(self.generate("CSC 401"))

    def test_more_than_20_courses_rejected(self):
        courses = [{"name": f"Course {i}", "difficulty": 3} for i in range(21)]
        self.assert_rejected(self.generate(courses), "courses")

    def test_20_courses_accepted(self):
        courses = [{"name": f"Course {i}", "difficulty": 3} for i in range(20)]
        response = self.generate(courses, hours=40)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["allocations"]), 20)

    def test_duplicate_names_rejected_and_named(self):
        cases = {
            "exact": ["CSC 401", "CSC 401"],
            "case": ["CSC 401", "csc 401"],
            "whitespace": ["CSC 401", "  CSC 401 "],
            "case and whitespace": [" csc 401", "CSC 401  "],
        }
        for label, names in cases.items():
            with self.subTest(label=label):
                courses = [{"name": n, "difficulty": 3} for n in names] + [{"name": "Other", "difficulty": 2}]
                response = self.generate(courses)
                self.assert_rejected(response, "Duplicate course name")
                self.assertIn("401", str(response.data))

    def test_different_names_are_not_duplicates(self):
        response = self.generate([{"name": "CSC 401", "difficulty": 3}, {"name": "CSC 402", "difficulty": 3}])
        self.assertEqual(response.status_code, 200)

    def test_total_hours_out_of_range_rejected(self):
        for hours in (0, 0.99, 169, -5, 1000):
            with self.subTest(hours=hours):
                response = self.generate([{"name": "A", "difficulty": 3}], hours=hours)
                self.assert_rejected(response, "total_available_hours")

    def test_non_numeric_or_non_finite_hours_rejected(self):
        for hours in ("abc", "nan", "inf", None):
            with self.subTest(hours=hours):
                response = self.generate([{"name": "A", "difficulty": 3}], hours=hours)
                self.assert_rejected(response, "total_available_hours")

    def test_hours_bounds_accepted(self):
        for hours in (1, 168):
            with self.subTest(hours=hours):
                response = self.generate([{"name": "A", "difficulty": 3}], hours=hours)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["allocations"][0]["allocated_hours"], float(hours))

    def test_extra_course_fields_are_dropped(self):
        response = self.generate([{"name": "A", "difficulty": 3, "colour": "red"}])
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("colour", StudyPlan.objects.get().plan_json["courses"][0])


class PlannerCourseNameMatchingTests(APITestCase):
    generate_url = "/api/planner/generate/"

    def setUp(self):
        self.user = User.objects.create_user(username="plannercase", password="TestPass123!")
        self.other = User.objects.create_user(username="plannercase2", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def generate(self, name, difficulty=3, hours=10):
        response = self.client.post(
            self.generate_url,
            {"total_available_hours": hours, "courses": [{"name": name, "difficulty": difficulty}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_differently_cased_names_in_separate_requests_share_one_course(self):
        self.generate("CSC 401", difficulty=4, hours=10)
        self.generate(" csc 401 ", difficulty=2, hours=8)
        courses = Course.objects.filter(user=self.user)
        self.assertEqual(courses.count(), 1)
        course = courses.get()
        self.assertEqual(course.name, "CSC 401")  # the stored name is kept
        self.assertEqual(course.difficulty, 2)
        self.assertEqual(course.weekly_target_hours, 8.0)

    def test_new_course_is_created_with_the_submitted_name(self):
        self.generate("csc 401")
        self.assertEqual(Course.objects.get().name, "csc 401")

    def test_other_users_courses_do_not_match(self):
        Course.objects.create(user=self.other, name="CSC 401", difficulty=5)
        self.generate("csc 401")
        self.assertEqual(Course.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Course.objects.get(user=self.other).difficulty, 5)

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_rule_fallback_uses_logs_under_any_casing(self, _):
        for name, actual in (("csc 401", 50), ("CSC 401", 70)):
            log = StudySessionLog.objects.create(
                user=self.user, course_name=name, planned_minutes=100, actual_minutes=actual, adherence_score=actual / 100
            )
            StudySessionLog.objects.filter(pk=log.pk).update(created_at=timezone.now() - timedelta(days=1))
        allocation = self.generate("Csc 401").data["allocations"][0]
        self.assertEqual(allocation["adjustment_source"], "rule")
        self.assertAlmostEqual(allocation["adherence_estimate"], 0.6)
        self.assertEqual(allocation["adherence_factor"], 0.9)

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_rule_fallback_ignores_other_users_logs(self, _):
        StudySessionLog.objects.create(
            user=self.other, course_name="CSC 401", planned_minutes=100, actual_minutes=10, adherence_score=0.1
        )
        allocation = self.generate("CSC 401").data["allocations"][0]
        self.assertEqual(allocation["adjustment_source"], "none")
