"""Saved weekly plans: reading never calls the model, writing only when something changed. The SDK is mocked."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.planner.models import Course

from .engine.gather import local_today
from .models import GeneratedPlan
from .plan import latest_plans, saved_plan_statuses, strategy_ids
from .test_ai_plan import PlanTestCase, faithful_plan, message
from .test_course_recommendations import log

LIST_URL = "/api/recommendations/courses/"
# A Wednesday, so "a day later" and "an hour later" stay in the same week.
START = datetime(2026, 10, 28, 12, 0, tzinfo=dt_timezone.utc)


class Clock:
    def __init__(self):
        self.now = START

    def __call__(self):
        return self.now

    def advance(self, **delta):
        self.now += timedelta(**delta)


@override_settings(AI_PLAN_ENABLED=True, AI_PLAN_DAILY_LIMIT=20)
class SavedPlanTestCase(PlanTestCase):
    def setUp(self):
        self.clock = Clock()
        patcher = mock.patch.object(timezone, "now", self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()
        self.client_mock = None

    def fake_client(self, *responses, side_effect=None):
        self.client_mock = super().fake_client(*responses, side_effect=side_effect)
        return self.client_mock

    def calls(self):
        return self.client_mock.messages.create.call_count

    def read(self, course=None):
        response = self.client.get(self.url(course))
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def write(self, course=None):
        response = self.client.post(self.url(course))
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def write_first_plan(self):
        self.fake_client(message(faithful_plan(self.output())))
        self.clock.advance(minutes=5)
        data = self.write()
        self.clock.advance(minutes=5)
        return data

    def queue_next_plan(self):
        self.course.refresh_from_db()
        self.client_mock.messages.create.side_effect = [message(faithful_plan(self.output()))]

    def list_status(self):
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.data)
        return {entry["course"]["name"]: entry["saved_plan"] for entry in response.data["courses"]}


class ReadTests(SavedPlanTestCase):
    def test_nothing_saved_returns_null_and_never_calls_the_model(self):
        client = self.fake_client()
        data = self.read()
        self.assertIsNone(data["saved"])
        self.assertEqual(
            {key: data[key] for key in ("written_at", "outdated", "new_sessions", "course_changed")},
            {"written_at": None, "outdated": False, "new_sessions": 0, "course_changed": False},
        )
        self.assertEqual(data["week_start"], "2026-10-26")
        client.messages.create.assert_not_called()
        self.assertFalse(GeneratedPlan.objects.exists())

    def test_saved_plan_is_returned_without_a_call_or_the_throttle(self):
        written = self.write_first_plan()
        with mock.patch("apps.recommendations.plan.allow_ai_call") as throttle:
            for _ in range(3):
                data = self.read()
        throttle.assert_not_called()
        self.assertEqual(self.calls(), 1)
        self.assertEqual(data["saved"], written["saved"])
        self.assertEqual(data["saved"]["source"], "ai")
        self.assertFalse(data["saved"]["throttled"])
        self.assertEqual(data["written_at"], GeneratedPlan.objects.get().created_at.isoformat())
        self.assertFalse(data["outdated"])

    def test_the_newest_plan_wins_whatever_its_input(self):
        self.write_first_plan()
        old = GeneratedPlan.objects.get()
        self.clock.advance(minutes=1)
        newer = GeneratedPlan.objects.create(
            user=self.user, course=self.course, week_start=old.week_start, input_hash="b" * 64,
            content={"intro": "Newer.", "items": []}, model_id="test-model",
        )
        self.assertEqual(self.read()["saved"]["intro"], newer.content["intro"])

    @override_settings(AI_PLAN_ENABLED=False)
    def test_ai_off_serves_the_rules_plan_as_before(self):
        client = self.fake_client()
        data = self.read()
        self.assertEqual(data["saved"]["source"], "rules")
        self.assertFalse(data["saved"]["throttled"])
        self.assertIsNone(data["written_at"])
        self.assertFalse(data["outdated"])
        client.messages.create.assert_not_called()


class OutdatedTests(SavedPlanTestCase):
    def test_a_new_session_makes_it_outdated(self):
        self.write_first_plan()
        log(self.user, "Calculus", 0)
        data = self.read()
        self.assertEqual((data["outdated"], data["new_sessions"], data["course_changed"]), (True, 1, False))
        self.clock.advance(minutes=1)
        log(self.user, "calculus", 0)
        data = self.read()
        self.assertEqual((data["outdated"], data["new_sessions"], data["course_changed"]), (True, 2, False))

    def test_other_courses_and_older_sessions_do_not_count(self):
        self.write_first_plan()
        self.make_course("Algebra")
        log(self.user, "Algebra", 0)
        log(self.user, "Calculus", 1)
        self.assertFalse(self.read()["outdated"])

    def test_editing_the_course_makes_it_outdated(self):
        self.write_first_plan()
        response = self.client.patch(f"/api/planner/courses/{self.course.id}/", {"difficulty": 4}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        data = self.read()
        self.assertEqual((data["outdated"], data["new_sessions"], data["course_changed"]), (True, 0, True))

    def test_both_at_once(self):
        self.write_first_plan()
        log(self.user, "Calculus", 0)
        self.client.patch(f"/api/planner/courses/{self.course.id}/", {"difficulty": 4}, format="json")
        data = self.read()
        self.assertEqual((data["outdated"], data["new_sessions"], data["course_changed"]), (True, 1, True))

    def test_the_calendar_moving_on_alone_does_not_count(self):
        self.write_first_plan()
        self.clock.advance(days=1)
        data = self.read()
        self.assertFalse(data["outdated"])
        self.assertEqual((data["new_sessions"], data["course_changed"]), (0, False))
        self.assertIsNotNone(data["saved"])
        self.assertFalse(self.list_status()["Calculus"]["outdated"])

    def test_an_exam_entering_the_window_swaps_a_strategy_and_outdates_the_plan(self):
        # update() leaves updated_at alone, so only the calendar moves the exam into the 21-day window.
        Course.objects.filter(pk=self.course.pk).update(exam_date=local_today() + timedelta(days=22))
        self.course.refresh_from_db()
        self.write_first_plan()
        written = {item["strategy_id"] for item in GeneratedPlan.objects.get().content["items"]}
        self.assertFalse(self.read()["outdated"])
        self.clock.advance(days=1)
        self.assertNotEqual(written, set(strategy_ids(self.output())))
        data = self.read()
        self.assertEqual(
            (data["outdated"], data["strategies_changed"], data["new_sessions"], data["course_changed"]),
            (True, True, 0, False),
        )
        self.assertTrue(self.list_status()["Calculus"]["strategies_changed"])

    def test_a_new_week_starts_without_a_plan(self):
        self.write_first_plan()
        self.clock.advance(days=7)
        data = self.read()
        self.assertIsNone(data["saved"])
        self.assertEqual(data["week_start"], "2026-11-02")
        self.assertIsNone(self.list_status()["Calculus"])


class WriteTests(SavedPlanTestCase):
    def test_nothing_new_returns_the_saved_plan_without_a_call(self):
        first = self.write_first_plan()
        again = self.write()
        self.assertEqual(self.calls(), 1)
        self.assertEqual(again, first)
        self.assertEqual(GeneratedPlan.objects.count(), 1)

    def test_outdated_calls_the_model_and_saves(self):
        first = self.write_first_plan()
        log(self.user, "Calculus", 0, planned=45, completion=0.9)
        self.queue_next_plan()
        data = self.write()
        self.assertEqual(self.calls(), 2)
        self.assertEqual(GeneratedPlan.objects.count(), 2)
        self.assertEqual(data["saved"]["source"], "ai")
        self.assertFalse(data["outdated"])
        self.assertEqual((data["new_sessions"], data["course_changed"]), (0, False))
        self.assertGreater(data["written_at"], first["written_at"])
        self.assertFalse(self.read()["outdated"])
        self.assertFalse(self.list_status()["Calculus"]["outdated"])

    def test_first_write_saves_when_nothing_was_written_yet(self):
        self.fake_client(message(faithful_plan(self.output())))
        data = self.write()
        self.assertEqual(self.calls(), 1)
        self.assertEqual(data["saved"]["source"], "ai")
        self.assertIsNotNone(data["written_at"])
        self.assertFalse(data["outdated"])

    def test_edit_that_changes_nothing_for_the_model_clears_without_a_call(self):
        self.write_first_plan()
        self.client.patch(f"/api/planner/courses/{self.course.id}/", {"difficulty": 5}, format="json")
        self.assertTrue(self.read()["outdated"])
        data = self.write()
        self.assertEqual(self.calls(), 1)
        self.assertEqual(GeneratedPlan.objects.count(), 1)
        self.assertEqual(data["saved"]["source"], "ai")
        self.assertFalse(data["outdated"])
        self.assertFalse(self.read()["outdated"])

    def test_returning_to_an_earlier_input_makes_that_plan_the_newest(self):
        self.write_first_plan()
        self.client.patch(f"/api/planner/courses/{self.course.id}/", {"difficulty": 4}, format="json")
        self.queue_next_plan()
        self.clock.advance(minutes=1)
        self.write()
        self.clock.advance(minutes=1)
        self.client.patch(f"/api/planner/courses/{self.course.id}/", {"difficulty": 5}, format="json")
        self.clock.advance(minutes=1)
        data = self.write()
        self.assertEqual(self.calls(), 2)
        self.assertFalse(data["outdated"])
        self.assertEqual(GeneratedPlan.objects.count(), 2)

    def test_fallback_saves_nothing_and_the_plan_stays_outdated(self):
        first = self.write_first_plan()
        log(self.user, "Calculus", 0)
        broken = faithful_plan(self.output())
        broken["intro"] = "Do 77 things this week."
        self.client_mock.messages.create.side_effect = [message(broken)]
        with self.assertLogs("apps.common.ai", "WARNING"):
            data = self.write()
        self.assertEqual(data["saved"]["source"], "rules")
        self.assertFalse(data["saved"]["throttled"])
        self.assertTrue(data["outdated"])
        self.assertEqual(data["new_sessions"], 1)
        self.assertEqual(data["written_at"], first["written_at"])
        self.assertEqual(GeneratedPlan.objects.count(), 1)
        self.assertEqual(self.read()["saved"]["source"], "ai")

    def test_a_first_write_that_falls_back_saves_nothing(self):
        self.fake_client(message({"intro": "", "items": []}))
        with self.assertLogs("apps.common.ai", "WARNING"):
            data = self.write()
        self.assertEqual(data["saved"]["source"], "rules")
        self.assertIsNone(data["written_at"])
        self.assertFalse(data["outdated"])
        self.assertFalse(GeneratedPlan.objects.exists())

    @override_settings(AI_PLAN_ENABLED=False)
    def test_ai_off_serves_rules_and_saves_nothing(self):
        client = self.fake_client()
        data = self.write()
        self.assertEqual(data["saved"]["source"], "rules")
        client.messages.create.assert_not_called()
        self.assertFalse(GeneratedPlan.objects.exists())


@override_settings(AI_PLAN_ENABLED=True, AI_PLAN_DAILY_LIMIT=1)
class ThrottleTests(SavedPlanTestCase):
    def test_only_writing_counts_against_the_daily_limit(self):
        cache.clear()
        self.write_first_plan()
        for _ in range(4):
            self.assertIsNotNone(self.read()["saved"])
        self.list_status()
        log(self.user, "Calculus", 0)
        data = self.write()
        self.assertEqual(self.calls(), 1)
        self.assertEqual(data["saved"]["source"], "rules")
        self.assertTrue(data["saved"]["throttled"])
        self.assertTrue(data["outdated"])
        self.assertEqual(GeneratedPlan.objects.count(), 1)

    def test_a_current_plan_does_not_use_the_budget(self):
        self.write_first_plan()
        self.assertEqual(self.write()["saved"]["source"], "ai")
        self.assertEqual(self.write()["saved"]["source"], "ai")
        self.assertEqual(self.calls(), 1)


class CourseListTests(SavedPlanTestCase):
    def test_every_course_has_a_status_or_null(self):
        self.make_course("Algebra")
        self.assertEqual(self.list_status(), {"Algebra": None, "Calculus": None})
        self.write_first_plan()
        log(self.user, "Calculus", 0)
        status = self.list_status()
        self.assertIsNone(status["Algebra"])
        self.assertEqual(
            set(status["Calculus"]), {"written_at", "outdated", "new_sessions", "course_changed", "strategies_changed"}
        )
        self.assertEqual((status["Calculus"]["outdated"], status["Calculus"]["new_sessions"]), (True, 1))
        self.assertEqual(status["Calculus"]["written_at"], GeneratedPlan.objects.get().created_at.isoformat())

    @override_settings(AI_PLAN_ENABLED=False)
    def test_null_with_ai_off(self):
        self.assertEqual(self.list_status(), {"Calculus": None})

    def test_statuses_take_one_query_after_the_plans_however_many_courses(self):
        courses = [self.course, self.make_course("Algebra"), self.make_course("History")]
        self.write_first_plan()
        week = GeneratedPlan.objects.get().week_start
        with self.assertNumQueries(1):
            plans = latest_plans(self.user, courses, week)
        current = {course.id: strategy_ids(self.output(course)) for course in courses}
        with self.assertNumQueries(1):  # sessions
            saved_plan_statuses(self.user, courses, plans, current)

    def test_the_list_adds_two_queries_for_the_statuses_however_many_courses(self):
        courses = [self.course, self.make_course("Algebra"), self.make_course("History")]
        self.fake_client(*(message(faithful_plan(self.output(course))) for course in courses))
        for course in courses:
            self.write(course)
        self.clock.advance(minutes=5)

        def list_queries():
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.client.get(LIST_URL).status_code, 200)
            return len(queries)

        list_queries()  # the first listing logs the shown strategies
        with_plans = list_queries()
        with override_settings(AI_PLAN_ENABLED=False):
            without = list_queries()
        self.assertEqual(with_plans - without, 2)  # the newest plans and the sessions since


class PlannerSaveTests(SavedPlanTestCase):
    """Changing a difficulty through the weekly planner outdates that course's written plan."""

    def setUp(self):
        super().setUp()
        self.algebra = self.make_course("Algebra")
        self.fake_client(
            message(faithful_plan(self.output())), message(faithful_plan(self.output(self.algebra)))
        )
        self.clock.advance(minutes=5)
        self.write()
        self.write(self.algebra)
        self.clock.advance(minutes=5)

    def save_plan(self, calculus, algebra):
        response = self.client.put(
            "/api/planner/plans/2026-10-26/",
            {
                "courses": [{"name": "Calculus", "difficulty": calculus}, {"name": "Algebra", "difficulty": algebra}],
                "total_hours": 8,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_a_changed_difficulty_outdates_that_course_only(self):
        self.save_plan(4, 5)
        data = self.read()
        self.assertEqual((data["outdated"], data["course_changed"], data["new_sessions"]), (True, True, 0))
        other = self.read(self.algebra)
        self.assertEqual((other["outdated"], other["course_changed"]), (False, False))
        self.assertEqual(self.list_status()["Calculus"]["course_changed"], True)
        self.assertEqual(self.list_status()["Algebra"]["outdated"], False)

    def test_different_hours_with_the_same_difficulty_do_not(self):
        self.save_plan(5, 5)
        for course in (self.course, self.algebra):
            self.assertFalse(self.read(course)["outdated"])
