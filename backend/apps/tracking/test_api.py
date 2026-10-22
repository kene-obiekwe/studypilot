from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.planner.models import Course

from .inference import forecast_course
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


class TrainingDataQueryTests(APITestCase):
    """The training-data view must not issue per-row queries, and must match the old per-row computation."""

    url = "/api/tracking/training-data/"

    def setUp(self):
        self.user = User.objects.create_user(username="nplusone", password="TestPass123!")
        self.other = User.objects.create_user(username="othernplusone", password="TestPass123!")
        self.client.force_authenticate(user=self.user)
        self.base = timezone.now().replace(microsecond=0) - timedelta(days=60)

    def make_log(self, user, course_name, offset, planned=60, actual=30):
        log = StudySessionLog.objects.create(
            user=user,
            course_name=course_name,
            planned_minutes=planned,
            actual_minutes=actual,
            focus_score=0.6,
            completion_rate=0.5,
            adherence_score=min(actual / planned, 1.0),
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=self.base + offset)
        return log

    def legacy_rows(self):
        """The original implementation: two queries per log."""
        rows = []
        for log in StudySessionLog.objects.filter(user=self.user).order_by("created_at", "id")[:1000]:
            course = Course.objects.filter(user=self.user, name=log.course_name).first()
            sessions = StudySessionLog.objects.filter(
                user=self.user,
                created_at__gte=log.created_at - timedelta(days=7),
                created_at__lte=log.created_at,
            ).count()
            rows.append(
                {
                    "user_id": self.user.id,
                    "course_name": log.course_name,
                    "difficulty": int(course.difficulty) if course else 3,
                    "planned_minutes": log.planned_minutes,
                    "actual_minutes": log.actual_minutes,
                    "focus_score": log.focus_score,
                    "completion_rate": log.completion_rate,
                    "adherence_score": log.adherence_score,
                    "sessions_last_7_days": sessions,
                    "created_at": log.created_at,
                }
            )
        return rows

    def build_fixture(self):
        Course.objects.create(user=self.user, name="CSC 401", difficulty=5)
        Course.objects.create(user=self.other, name="MTH 401", difficulty=1)
        Course.objects.create(user=self.other, name="PHY 301", difficulty=2)
        day = timedelta(days=1)
        self.make_log(self.user, "CSC 401", timedelta(0))
        self.make_log(self.user, "CSC 401", day)
        self.make_log(self.user, "MTH 401", day)  # same instant as the previous log
        self.make_log(self.user, "MTH 401", 7 * day)  # exactly 7 days after the first log
        self.make_log(self.user, "CSC 401", 7 * day + timedelta(seconds=1))
        self.make_log(self.user, "PHY 301", 8 * day)
        self.make_log(self.user, "CSC 401", 30 * day)
        self.make_log(self.user, "CSC 401", 30 * day + timedelta(hours=3), planned=90, actual=90)
        self.make_log(self.other, "CSC 401", 2 * day)
        self.make_log(self.other, "CSC 401", 3 * day)

    def test_matches_the_per_row_computation(self):
        self.build_fixture()
        expected = self.legacy_rows()
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(expected), 8)
        self.assertEqual(response.data["rows"], expected)
        self.assertEqual(response.data["count"], 8)

    def test_fixture_exercises_the_edge_cases(self):
        self.build_fixture()
        rows = self.client.get(self.url).data["rows"]
        # Ties count each other, the 7-day boundary is inclusive, and other users are ignored.
        self.assertEqual([row["sessions_last_7_days"] for row in rows], [1, 3, 3, 4, 4, 5, 1, 2])
        # Only the caller's own courses supply a difficulty; everything else defaults to 3.
        self.assertEqual([row["difficulty"] for row in rows], [5, 5, 3, 3, 5, 3, 5, 5])

    def test_query_count_does_not_grow_with_the_number_of_logs(self):
        for count in (3, 30):
            StudySessionLog.objects.filter(user=self.user).delete()
            for i in range(count):
                self.make_log(self.user, f"Course {i % 3}", timedelta(hours=i))
            with self.subTest(logs=count), self.assertNumQueries(2):
                self.assertEqual(self.client.get(self.url).data["count"], count)

    def test_empty_history_needs_no_extra_queries(self):
        with self.assertNumQueries(2):
            self.assertEqual(self.client.get(self.url).data, {"rows": [], "count": 0})


class SessionLogFiniteAndNameTests(APITestCase):
    url = "/api/tracking/session-log/"

    def setUp(self):
        self.user = User.objects.create_user(username="finitelog", password="TestPass123!")
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

    def test_non_finite_scores_rejected(self):
        for field in ("focus_score", "completion_rate"):
            for value in ("nan", "inf", "-inf"):
                with self.subTest(field=field, value=value):
                    response = self.post(**{field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.data[field], ["Must be a finite number."])
        self.assertEqual(StudySessionLog.objects.count(), 0)

    def test_blank_or_whitespace_course_name_rejected(self):
        for name in ("", "   ", "\t\n"):
            with self.subTest(name=name):
                response = self.post(course_name=name)
                self.assertEqual(response.status_code, 400)
                self.assertIn("course_name", response.data)
        self.assertEqual(StudySessionLog.objects.count(), 0)

    def test_course_name_is_trimmed(self):
        self.assertEqual(self.post(course_name="  CSC 401  ").status_code, 200)
        self.assertEqual(StudySessionLog.objects.get().course_name, "CSC 401")


class CourseNameMatchingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="casematch", password="TestPass123!")
        self.other = User.objects.create_user(username="othercase", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def make_log(self, user, course_name, days_ago, planned=60, actual=60):
        log = StudySessionLog.objects.create(
            user=user,
            course_name=course_name,
            planned_minutes=planned,
            actual_minutes=actual,
            adherence_score=min(actual / planned, 1.0),
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=timezone.now() - timedelta(days=days_ago))

    def test_logs_under_different_casing_feed_one_forecast_history(self):
        self.make_log(self.user, "CSC 401", 20)
        self.make_log(self.user, "csc 401", 13)
        self.make_log(self.user, "Csc 401", 6)
        self.make_log(self.other, "CSC 401", 25)  # another user's history never counts

        for name in ("CSC 401", "csc 401", "cSc 401"):
            with self.subTest(name=name):
                forecast = forecast_course(self.user, name)
                self.assertEqual(forecast.weeks_history, 2)
                self.assertEqual(forecast.features["weeks_history"], 2.0)

    def test_history_under_a_single_casing_is_not_split_by_a_query_casing(self):
        self.make_log(self.user, "CSC 401", 20)
        self.make_log(self.user, "CSC 401", 6)
        self.assertEqual(forecast_course(self.user, "csc 401").weeks_history, forecast_course(self.user, "CSC 401").weeks_history)

    def test_predict_lists_a_course_once_under_its_latest_casing(self):
        self.make_log(self.user, "csc 401", 20)
        self.make_log(self.user, "CSC 401", 13)
        self.make_log(self.user, "Csc 401", 6)
        self.make_log(self.user, "MTH 401", 5)
        self.make_log(self.user, "mth 401", 20)
        response = self.client.post("/api/tracking/predict/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["course_name"] for item in response.data], ["Csc 401", "MTH 401"])
        self.assertEqual(response.data[0]["weeks_history"], 2)

    def test_predict_with_a_course_name_matches_any_casing(self):
        self.make_log(self.user, "CSC 401", 20)
        self.make_log(self.user, "csc 401", 6)
        response = self.client.post("/api/tracking/predict/", {"course_name": "cSC 401"}, format="json")
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["course_name"], "cSC 401")
        self.assertEqual(response.data[0]["weeks_history"], 2)
