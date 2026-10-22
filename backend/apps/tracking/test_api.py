from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.planner.models import Course

from .models import StudySessionLog


class SessionLogValidationTests(APITestCase):
    url = "/api/tracking/session-log/"

    def setUp(self):
        self.user = User.objects.create_user(username="loguser", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def post(self, **overrides):
        data = {
            "course_name": "CSC 401",
            "planned_minutes": 60,
            "actual_minutes": 45,
            "focus_score": 0.6,
            "completion_rate": 0.7,
        }
        data.update(overrides)
        return self.client.post(self.url, data, format="json")

    def assert_rejected(self, field, value):
        response = self.post(**{field: value})
        self.assertEqual(response.status_code, 400, f"{field}={value!r}")
        self.assertIn(field, response.data)
        self.assertEqual(StudySessionLog.objects.count(), 0)

    def test_planned_minutes_must_be_at_least_one(self):
        self.assert_rejected("planned_minutes", 0)
        self.assert_rejected("planned_minutes", -5)

    def test_actual_minutes_cannot_be_negative(self):
        self.assert_rejected("actual_minutes", -1)

    def test_focus_score_must_be_within_unit_interval(self):
        self.assert_rejected("focus_score", -0.01)
        self.assert_rejected("focus_score", 1.01)

    def test_completion_rate_must_be_within_unit_interval(self):
        self.assert_rejected("completion_rate", -0.01)
        self.assert_rejected("completion_rate", 1.01)

    def test_course_name_is_required(self):
        response = self.client.post(
            self.url,
            {"planned_minutes": 60, "actual_minutes": 45, "focus_score": 0.6, "completion_rate": 0.7},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("course_name", response.data)

    def test_boundary_values_are_accepted(self):
        response = self.post(planned_minutes=1, actual_minutes=0, focus_score=0, completion_rate=1)
        self.assertEqual(response.status_code, 200)
        log = StudySessionLog.objects.get()
        self.assertEqual(log.adherence_score, 0.0)
        self.assertEqual(log.focus_score, 0.0)
        self.assertEqual(log.completion_rate, 1.0)

    def test_upper_boundary_scores_are_accepted(self):
        response = self.post(focus_score=1, completion_rate=0)
        self.assertEqual(response.status_code, 200)

    def test_adherence_is_actual_over_planned(self):
        response = self.post(planned_minutes=120, actual_minutes=90)
        self.assertEqual(response.data["computed"]["adherence"], 0.75)
        self.assertEqual(StudySessionLog.objects.get().adherence_score, 0.75)

    def test_adherence_is_capped_at_one(self):
        response = self.post(planned_minutes=60, actual_minutes=200)
        self.assertEqual(response.data["computed"]["adherence"], 1.0)
        self.assertEqual(StudySessionLog.objects.get().adherence_score, 1.0)

    def test_log_is_stored_against_the_caller(self):
        self.post()
        self.assertEqual(StudySessionLog.objects.get().user, self.user)


class SessionHistoryTests(APITestCase):
    url = "/api/tracking/history/"

    def setUp(self):
        self.user = User.objects.create_user(username="histuser", password="TestPass123!")
        self.other = User.objects.create_user(username="otherhist", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def make_log(self, user, course_name, age_days=0):
        log = StudySessionLog.objects.create(
            user=user, course_name=course_name, planned_minutes=60, actual_minutes=30, adherence_score=0.5
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=timezone.now() - timedelta(days=age_days))
        return log

    def test_history_is_empty_without_logs(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"items": []})

    def test_history_returns_only_callers_logs(self):
        self.make_log(self.user, "Mine")
        self.make_log(self.other, "Theirs")
        response = self.client.get(self.url)
        self.assertEqual([item["course_name"] for item in response.data["items"]], ["Mine"])

    def test_history_is_newest_first(self):
        self.make_log(self.user, "Oldest", age_days=3)
        self.make_log(self.user, "Newest", age_days=1)
        self.make_log(self.user, "Middle", age_days=2)
        response = self.client.get(self.url)
        self.assertEqual([item["course_name"] for item in response.data["items"]], ["Newest", "Middle", "Oldest"])

    def test_history_item_shape(self):
        self.make_log(self.user, "Mine")
        item = self.client.get(self.url).data["items"][0]
        for key in (
            "id",
            "course_name",
            "planned_minutes",
            "actual_minutes",
            "focus_score",
            "completion_rate",
            "adherence_score",
            "predicted_adherence",
            "model_version",
            "created_at",
        ):
            self.assertIn(key, item)


class TrainingDataTests(APITestCase):
    url = "/api/tracking/training-data/"

    def setUp(self):
        self.user = User.objects.create_user(username="trainuser", password="TestPass123!")
        self.other = User.objects.create_user(username="othertrain", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def make_log(self, user, course_name, planned=60, actual=30):
        return StudySessionLog.objects.create(
            user=user,
            course_name=course_name,
            planned_minutes=planned,
            actual_minutes=actual,
            focus_score=0.6,
            completion_rate=0.7,
            adherence_score=actual / planned,
        )

    def test_empty_without_logs(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"rows": [], "count": 0})

    def test_returns_only_callers_rows(self):
        self.make_log(self.user, "Mine")
        self.make_log(self.other, "Theirs")
        response = self.client.get(self.url)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual([row["course_name"] for row in response.data["rows"]], ["Mine"])
        self.assertEqual(response.data["rows"][0]["user_id"], self.user.id)

    def test_row_values(self):
        self.make_log(self.user, "CSC 401", planned=120, actual=90)
        Course.objects.create(user=self.user, name="CSC 401", difficulty=5)
        row = self.client.get(self.url).data["rows"][0]
        self.assertEqual(row["difficulty"], 5)
        self.assertEqual(row["planned_minutes"], 120)
        self.assertEqual(row["actual_minutes"], 90)
        self.assertEqual(row["focus_score"], 0.6)
        self.assertEqual(row["completion_rate"], 0.7)
        self.assertEqual(row["adherence_score"], 0.75)
        self.assertEqual(row["sessions_last_7_days"], 1)

    def test_difficulty_defaults_to_three_without_a_course_row(self):
        self.make_log(self.user, "Unplanned")
        self.assertEqual(self.client.get(self.url).data["rows"][0]["difficulty"], 3)

    def test_difficulty_ignores_other_users_course_rows(self):
        Course.objects.create(user=self.other, name="Shared", difficulty=5)
        self.make_log(self.user, "Shared")
        self.assertEqual(self.client.get(self.url).data["rows"][0]["difficulty"], 3)

    def test_sessions_last_7_days_ignores_other_users(self):
        self.make_log(self.user, "Mine")
        self.make_log(self.other, "Theirs")
        self.make_log(self.other, "Theirs")
        self.assertEqual(self.client.get(self.url).data["rows"][0]["sessions_last_7_days"], 1)
