"""API, gatherer and logging tests for course-aware recommendations (4B.2)."""

import re
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from io import StringIO
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.planner.models import Course, StudyPlan
from apps.tracking import inference
from apps.tracking.models import StudySessionLog

from .engine.gather import gather_course_data, local_today, week_start
from .models import ShownStrategy, StrategyFeedback

URL = "/api/recommendations/courses/"
FEEDBACK_URL = "/api/recommendations/feedback/"


def log(user, course_name, days_ago, planned=60, completion=0.7, adherence=0.7, focus=0.65):
    entry = StudySessionLog.objects.create(
        user=user,
        course_name=course_name,
        planned_minutes=planned,
        actual_minutes=int(planned * adherence),
        focus_score=focus,
        completion_rate=completion,
        adherence_score=adherence,
    )
    StudySessionLog.objects.filter(pk=entry.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
    return entry


# No model in these tests: forecasts are "model_unavailable", so low_forecast never fires.
@mock.patch.object(inference, "get_model", return_value=None)
class CourseRecommendationsApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="learner", password="TestPass123!")
        self.client.force_authenticate(self.user)
        today = local_today()
        self.calculus = Course.objects.create(
            user=self.user,
            name="Calculus",
            difficulty=5,
            learning_demands=["problem_solving"],
            builds_on_earlier=True,
            assessment_format="timed_problem_exam",
            exam_date=today + timedelta(days=18),
        )
        self.history = Course.objects.create(
            user=self.user,
            name="HIS 210",
            difficulty=3,
            learning_demands=["writing", "conceptual"],
            builds_on_earlier=False,
            assessment_format="essay_exam",
        )

    def seed_calculus_history(self):
        # Worked example A: 4 long sessions at ~35% completion, 4 short at ~72%, about 6 days apart.
        for days_ago, planned, completion in (
            (25, 90, 0.30), (25, 60, 0.70), (19, 90, 0.40), (19, 45, 0.75),
            (13, 90, 0.35), (6, 60, 0.70), (6, 90, 0.35), (0, 60, 0.73),
        ):
            log(self.user, "calculus", days_ago, planned=planned, completion=completion)

    def get(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def by_name(self, payload):
        return {item["course"]["name"]: item for item in payload["courses"]}

    def test_requires_authentication(self, _):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)
        self.assertEqual(self.client.post(FEEDBACK_URL, {}, format="json").status_code, 401)

    def test_lists_every_course_with_the_structured_output(self, _):
        payload = self.get()
        self.assertEqual([c["course"]["name"] for c in payload["courses"]], ["Calculus", "HIS 210"])
        self.assertEqual(payload["week_start"], week_start(local_today()).isoformat())
        for item in payload["courses"]:
            self.assertEqual(set(item), {"course", "evidence", "recommendations"})
            self.assertLessEqual(len(item["recommendations"]), 4)
            for rec in item["recommendations"]:
                self.assertIsInstance(rec["shown_id"], int)
                self.assertEqual(rec["feedback"], {"rating": None, "tried": False})
                for field in ("strategy_id", "kind", "title", "what", "how", "why", "source", "priority", "basis", "facts"):
                    self.assertIn(field, rec)

    def test_calculus_history_through_the_database(self, _):
        self.seed_calculus_history()
        item = self.by_name(self.get(course_id=self.calculus.id))["Calculus"]
        self.assertEqual(item["evidence"]["summary"], "Based on 8 sessions over 4 weeks")
        self.assertEqual(
            [r["strategy_id"] for r in item["recommendations"]],
            ["format_matched_practice", "split_long_sessions", "spaced_schedule", "worked_examples"],
        )
        split = item["recommendations"][1]
        self.assertEqual((split["facts"]["n_blocks"], split["facts"]["block_minutes"]), (3, 30))
        self.assertEqual([int(n) for n in re.findall(r"\d+", split["why"])], [90, 35, 4, 72, 4])
        # The case-insensitive name match picked up logs stored as "calculus".
        self.assertEqual(item["evidence"]["sessions"], 8)

    def test_no_history_course_is_settings_only(self, _):
        item = self.by_name(self.get(course_id=self.history.id))["HIS 210"]
        self.assertEqual(item["evidence"]["summary"], "Based on your course settings only")
        self.assertEqual(item["evidence"]["forecast"]["status"], "insufficient_history")
        self.assertTrue(all(r["basis"] == "settings" for r in item["recommendations"]))

    def test_course_id_filter_and_errors(self, _):
        self.assertEqual(len(self.get(course_id=self.history.id)["courses"]), 1)
        self.assertEqual(self.client.get(URL, {"course_id": "abc"}).status_code, 400)
        self.assertEqual(self.client.get(URL, {"course_id": 999999}).status_code, 404)
        other = User.objects.create_user(username="other", password="TestPass123!")
        foreign = Course.objects.create(user=other, name="Theirs")
        self.assertEqual(self.client.get(URL, {"course_id": foreign.id}).status_code, 404)
        self.assertFalse(ShownStrategy.objects.filter(course=foreign).exists())

    def test_isolation_between_users(self, _):
        self.seed_calculus_history()
        other = User.objects.create_user(username="other", password="TestPass123!")
        Course.objects.create(user=other, name="Calculus", difficulty=5, learning_demands=["problem_solving"])
        self.client.force_authenticate(other)
        payload = self.get()
        self.assertEqual([c["course"]["name"] for c in payload["courses"]], ["Calculus"])
        # The first user's logs under the same course name don't leak into the other user's evidence.
        self.assertEqual(payload["courses"][0]["evidence"]["sessions"], 0)
        self.assertFalse(ShownStrategy.objects.filter(user=other, course=self.calculus).exists())

    def test_shown_strategies_are_logged_once_per_iso_week(self, _):
        first = self.get()
        count = ShownStrategy.objects.count()
        self.assertEqual(count, sum(len(c["recommendations"]) for c in first["courses"]))
        second = self.get()
        self.assertEqual(ShownStrategy.objects.count(), count)
        shown_ids = lambda payload: [r["shown_id"] for c in payload["courses"] for r in c["recommendations"]]
        self.assertEqual(shown_ids(first), shown_ids(second))
        self.assertTrue(all(row.times_shown == 2 for row in ShownStrategy.objects.all()))

        row = ShownStrategy.objects.get(pk=shown_ids(first)[0])
        self.assertEqual(row.week_start, week_start(local_today()))
        self.assertEqual(row.course_name, row.course.name)

        next_week = timezone.now() + timedelta(days=7)
        with mock.patch("django.utils.timezone.now", return_value=next_week):
            third = self.get()
        self.assertEqual(ShownStrategy.objects.count(), 2 * count)
        self.assertTrue(set(shown_ids(third)).isdisjoint(shown_ids(first)))

    def test_deleting_a_course_keeps_its_shown_history(self, _):
        shown_id = self.get(course_id=self.history.id)["courses"][0]["recommendations"][0]["shown_id"]
        self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": "helpful"}, format="json")
        self.history.delete()
        row = ShownStrategy.objects.get(pk=shown_id)
        self.assertIsNone(row.course)
        self.assertEqual(row.course_name, "HIS 210")
        self.assertTrue(StrategyFeedback.objects.filter(shown=row, value="helpful").exists())


@mock.patch.object(inference, "get_model", return_value=None)
class StrategyFeedbackApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="learner", password="TestPass123!")
        self.client.force_authenticate(self.user)
        Course.objects.create(user=self.user, name="HIS 210", learning_demands=["writing"])

    def shown_id(self):
        return self.client.get(URL).data["courses"][0]["recommendations"][0]["shown_id"]

    def send(self, shown_id, value):
        return self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": value}, format="json")

    def test_ratings_replace_each_other_and_tried_is_independent(self, _):
        shown_id = self.shown_id()
        response = self.send(shown_id, "helpful")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"shown_id": shown_id, "rating": "helpful", "tried": False})
        self.assertEqual(self.send(shown_id, "tried").data, {"shown_id": shown_id, "rating": "helpful", "tried": True})
        self.assertEqual(self.send(shown_id, "not_helpful").data, {"shown_id": shown_id, "rating": "not_helpful", "tried": True})
        self.assertEqual(
            sorted(StrategyFeedback.objects.filter(shown_id=shown_id).values_list("value", flat=True)),
            ["not_helpful", "tried"],
        )

    def test_repeats_are_idempotent(self, _):
        shown_id = self.shown_id()
        self.send(shown_id, "helpful")
        self.send(shown_id, "helpful")
        self.assertEqual(StrategyFeedback.objects.filter(shown_id=shown_id).count(), 1)

    def test_state_is_echoed_by_the_recommendations_endpoint(self, _):
        shown_id = self.shown_id()
        self.send(shown_id, "tried")
        rec = next(
            r for c in self.client.get(URL).data["courses"] for r in c["recommendations"] if r["shown_id"] == shown_id
        )
        self.assertEqual(rec["feedback"], {"rating": None, "tried": True})

    def test_validation(self, _):
        shown_id = self.shown_id()
        self.assertEqual(self.send(shown_id, "love_it").status_code, 400)
        self.assertEqual(self.client.post(FEEDBACK_URL, {"value": "helpful"}, format="json").status_code, 400)
        self.assertEqual(self.send(0, "helpful").status_code, 400)
        self.assertEqual(self.send(999999, "helpful").status_code, 404)
        self.assertFalse(StrategyFeedback.objects.exists())

    def test_cannot_rate_another_users_strategy(self, _):
        shown_id = self.shown_id()
        other = User.objects.create_user(username="other", password="TestPass123!")
        self.client.force_authenticate(other)
        self.assertEqual(self.send(shown_id, "helpful").status_code, 404)
        self.assertFalse(StrategyFeedback.objects.exists())


@mock.patch.object(inference, "get_model", return_value=None)
class GathererTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="learner", password="TestPass123!")
        self.course = Course.objects.create(user=self.user, name="CSC 401")

    def test_window_keeps_the_last_28_days_but_counts_all_sessions(self, _):
        for days_ago in (0, 27, 28, 40):
            log(self.user, "CSC 401", days_ago)
        data = gather_course_data(self.user, self.course)
        self.assertEqual(len(data.sessions), 2)
        self.assertEqual(data.total_sessions, 4)

    def test_adherence_is_clamped(self, _):
        log(self.user, "CSC 401", 1, adherence=1.8)
        self.assertEqual(gather_course_data(self.user, self.course).sessions[0].adherence, 1.0)

    def test_uses_this_weeks_plan_only(self, _):
        today = local_today()
        monday = week_start(today)
        StudyPlan.objects.create(
            user=self.user, week_start=monday - timedelta(days=7),
            plan_json={"allocations": [{"course": "CSC 401", "allocated_hours": 9}]},
        )
        self.assertIsNone(gather_course_data(self.user, self.course).plan)
        StudyPlan.objects.create(
            user=self.user, week_start=monday, plan_json={"allocations": [{"course": "csc 401", "allocated_hours": 4}]}
        )
        StudySessionLog.objects.create(
            user=self.user, course_name="CSC 401", planned_minutes=60, actual_minutes=30, adherence_score=0.5
        )
        plan = gather_course_data(self.user, self.course).plan
        self.assertEqual(plan.allocated_hours, 4)
        self.assertEqual(plan.logged_hours, 0.5)


# A fixed Saturday, so the week-dependent patterns (under_studied) don't vary with the run date.
FIXED_NOW = datetime(2026, 10, 24, 12, 0, tzinfo=dt_timezone.utc)


@override_settings(DEBUG=True)
@mock.patch("django.utils.timezone.now", return_value=FIXED_NOW)
class SeededPilotTests(APITestCase):
    def test_pilot_users_get_different_recommendation_sets(self, _):
        call_command("seed_pilot_data", stdout=StringIO())
        strategies = {}
        for user in User.objects.filter(username__startswith="pilot_").order_by("username"):
            self.client.force_authenticate(user)
            payload = self.client.get(URL).data
            for item in payload["courses"]:
                self.assertTrue(item["course"]["learning_demands"], item["course"]["name"])
            strategies[user.username] = frozenset(
                rec["strategy_id"] for item in payload["courses"] for rec in item["recommendations"]
            )
        self.assertEqual(len(strategies), 5)
        # Strategy sets alone (not course + strategy pairs, which differ trivially) are all different.
        self.assertEqual(len(set(strategies.values())), 5, strategies)
        self.assertGreaterEqual(len(frozenset().union(*strategies.values())), 10)
        self.assertIn("split_long_sessions", strategies["pilot_average"])
        self.assertIn("right_size_plans", strategies["pilot_struggling"])
        self.assertNotIn("right_size_plans", strategies["pilot_consistent"])
