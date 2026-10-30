"""Strategy ratings that act (6.6g): rest, helpful-first, persistence, Show again, the saved AI plan.

Rules only: no learning (that stays in 7.1) and no AI calls.
"""

import importlib
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.planner.models import Course
from apps.tracking import inference

from .engine import recommend
from .engine.diagnostics import RatingInfo
from .engine.gather import gather_course_data, local_today
from .engine.library import LIBRARY
from .engine.selection import REST_DAYS, current_ratings, technique_order
from .models import ShownStrategy, StrategyFeedback, StrategyRating
from .shown import clear_rating, record_feedback
from .test_engine import TODAY, course, data, ids, session
from .test_saved_plan import SavedPlanTestCase

URL = "/api/recommendations/courses/"
FEEDBACK_URL = "/api/recommendations/feedback/"
SHOW_AGAIN_URL = "/api/recommendations/show-again/"


def rated(today=TODAY, **ratings) -> dict[str, RatingInfo]:
    """rated(worked_examples=("not_helpful", 3)) -> rated 3 days before `today`."""
    return {
        strategy_id: RatingInfo(value, today - timedelta(days=days_ago))
        for strategy_id, (value, days_ago) in ratings.items()
    }


def with_ratings(course_data, ratings):
    from dataclasses import replace

    return replace(course_data, ratings=ratings)


# A course with no history: the schedule fallback plus three techniques.
TRAITS = dict(learning_demands=("conceptual", "problem_solving"), difficulty=3)


class RestRuleTests(SimpleTestCase):
    def output(self, ratings=None, **traits):
        base = data(course_traits=course(**{**TRAITS, **traits}))
        return recommend(with_ratings(base, ratings or {}))

    def test_nothing_rated_changes_nothing(self):
        plain = self.output()
        self.assertEqual(plain["resting"], [])
        self.assertEqual(ids(plain), ids(self.output({})))

    def test_not_helpful_rests_for_28_days(self):
        plain = ids(self.output())
        target = "worked_examples"
        self.assertIn(target, plain)
        self.assertNotIn(target, ids(self.output(rated(**{target: ("not_helpful", 0)}))))
        self.assertNotIn(target, ids(self.output(rated(**{target: ("not_helpful", 27)}))))
        self.assertIn(target, ids(self.output(rated(**{target: ("not_helpful", 28)}))))
        self.assertIn(target, ids(self.output(rated(**{target: ("not_helpful", 29)}))))

    def test_an_expired_rest_counts_as_no_rating_everywhere(self):
        ratings = rated(worked_examples=("not_helpful", REST_DAYS + 1))
        output = self.output(ratings)
        self.assertEqual(output["resting"], [])
        self.assertEqual(current_ratings(with_ratings(data(), ratings)), {})

    def test_resting_lists_the_title_and_the_day_it_may_return(self):
        output = self.output(rated(worked_examples=("not_helpful", 3)))
        self.assertEqual(
            output["resting"],
            [{"strategy_id": "worked_examples", "title": LIBRARY["worked_examples"].title, "until": (TODAY + timedelta(days=25)).isoformat()}],
        )

    def test_the_next_technique_takes_the_place(self):
        base = data(course_traits=course(**TRAITS))
        order = [strategy_id for strategy_id, _ in technique_order(base)]
        slots = len([i for i in ids(recommend(base)) if i in order])
        output = self.output(rated(**{order[1]: ("not_helpful", 2)}))
        chosen = [i for i in ids(output) if i in order]
        self.assertEqual(len(chosen), slots)
        self.assertEqual(set(chosen), set([s for s in order if s != order[1]][:slots]))

    def test_the_schedule_fallback_can_rest_too(self):
        self.assertIn("spaced_schedule", ids(self.output()))
        output = self.output(rated(spaced_schedule=("not_helpful", 1)))
        self.assertNotIn("spaced_schedule", ids(output))
        self.assertEqual([r["strategy_id"] for r in output["resting"]], ["spaced_schedule"])

    def test_an_exam_strategy_rests_and_the_next_one_fills_the_place(self):
        traits = dict(TRAITS, exam_date=TODAY + timedelta(days=5), assessment_format="essay_exam")
        plain = self.output(**traits)
        exam = next(r["strategy_id"] for r in plain["recommendations"] if r["kind"] == "exam")
        rested = self.output(rated(**{exam: ("not_helpful", 1)}), **traits)
        self.assertNotIn(exam, ids(rested))
        self.assertEqual(len(rested["recommendations"]), len(plain["recommendations"]))

    def test_a_resting_warmup_is_not_folded_into_the_top_technique(self):
        # Exam + 2 behaviour strategies leave one technique slot, so the warm-up would be a step.
        sessions = [session(days_ago=d, adherence=0.3, focus=0.3) for d in (1, 6, 11, 16)]
        traits = course(
            learning_demands=("problem_solving",), builds_on_earlier=True, difficulty=5, exam_date=TODAY + timedelta(days=5)
        )
        base = data(sessions, course_traits=traits)
        folded = next(r for r in recommend(base)["recommendations"] if r["kind"] == "technique")
        self.assertTrue(folded["facts"]["warmup_step"])

        output = recommend(with_ratings(base, rated(prerequisite_warmup=("not_helpful", 1))))
        top = next(r for r in output["recommendations"] if r["kind"] == "technique")
        self.assertNotIn("warmup_step", top["facts"])
        self.assertNotIn("earlier topic", " ".join(top["how"]))
        self.assertEqual([r["strategy_id"] for r in output["resting"]], ["prerequisite_warmup"])

    def test_everything_resting_gives_an_empty_list(self):
        base = data(course_traits=course())  # no demands: retrieval practice, plus the schedule fallback
        shown = ids(recommend(base))
        self.assertEqual(sorted(shown), ["retrieval_practice", "spaced_schedule"])
        output = recommend(with_ratings(base, rated(**{i: ("not_helpful", 2) for i in shown})))
        self.assertEqual(output["recommendations"], [])
        self.assertEqual(sorted(r["strategy_id"] for r in output["resting"]), sorted(shown))

    def test_resting_strategies_that_do_not_fit_are_still_listed(self):
        output = self.output(rated(mock_exam=("not_helpful", 1)))
        self.assertEqual([r["strategy_id"] for r in output["resting"]], ["mock_exam"])


class HelpfulFirstTests(SimpleTestCase):
    def test_a_helpful_technique_goes_ahead_of_unrated_ones_when_places_are_short(self):
        base = data(course_traits=course(**TRAITS))
        order = [strategy_id for strategy_id, _ in technique_order(base)]
        shown = [i for i in ids(recommend(base)) if i in order]
        left_out = next(s for s in order if s not in shown)
        output = recommend(with_ratings(base, rated(**{left_out: ("helpful", 40)})))
        self.assertIn(left_out, ids(output))
        self.assertEqual(len([i for i in ids(output) if i in order]), len(shown))
        # The priority number is still the one from the technique order.
        rec = next(r for r in output["recommendations"] if r["strategy_id"] == left_out)
        self.assertEqual(rec["priority"], 60 + order.index(left_out))

    def test_helpful_never_expires(self):
        base = data(course_traits=course(**TRAITS))
        order = [strategy_id for strategy_id, _ in technique_order(base)]
        left_out = next(s for s in order if s not in ids(recommend(base)))
        output = recommend(with_ratings(base, rated(**{left_out: ("helpful", 400)})))
        self.assertIn(left_out, ids(output))

    def test_helpful_does_not_change_the_order_when_nothing_is_left_out(self):
        base = data(course_traits=course(learning_demands=("memorisation",)))
        helpful = ids(recommend(with_ratings(base, rated(flashcard_self_testing=("helpful", 1)))))
        self.assertEqual(helpful, ids(recommend(base)))

    def test_a_helpful_behaviour_strategy_beats_an_unrated_one_for_the_places(self):
        # Poor adherence, focus and spacing all fire; only two behaviour places exist.
        sessions = [session(days_ago=d, adherence=0.3, focus=0.3) for d in (1, 6, 11, 16)]
        base = data(sessions, course_traits=course(**TRAITS))
        plain = [r["strategy_id"] for r in recommend(base)["recommendations"] if r["kind"] != "technique"]
        self.assertLessEqual(len(plain), 2)
        helpful = recommend(with_ratings(base, rated(phone_out_of_room=("helpful", 3))))
        self.assertIn("phone_out_of_room", ids(helpful))


class RecommendationFeedbackBase(APITestCase):
    def setUp(self):
        patcher = mock.patch.object(inference, "get_model", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="learner", password="TestPass123!")
        self.client.force_authenticate(self.user)
        self.course = Course.objects.create(user=self.user, name="HIS 210", learning_demands=["writing", "conceptual"])

    def listing(self):
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["courses"][0]

    def rec(self, strategy_id, listing=None):
        listing = listing or self.listing()
        return next((r for r in listing["recommendations"] if r["strategy_id"] == strategy_id), None)

    def rate(self, strategy_id, value, listing=None):
        shown_id = self.rec(strategy_id, listing)["shown_id"]
        response = self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": value}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def first_technique(self):
        return next(r["strategy_id"] for r in self.listing()["recommendations"] if r["kind"] == "technique")


class RecordFeedbackTests(RecommendationFeedbackBase):
    def test_a_rating_is_kept_for_the_course(self):
        strategy_id = self.first_technique()
        self.rate(strategy_id, "helpful")
        rating = StrategyRating.objects.get()
        self.assertEqual(
            (rating.user, rating.course, rating.strategy_id, rating.value), (self.user, self.course, strategy_id, "helpful")
        )
        self.assertIsNone(rating.cleared_at)

    def test_changing_the_value_resets_rated_at_and_repeating_it_does_not(self):
        strategy_id = self.first_technique()
        shown = ShownStrategy.objects.get(strategy_id=strategy_id)
        start = datetime(2026, 10, 1, 9, 0, tzinfo=dt_timezone.utc)
        record_feedback(shown, "helpful", start)
        record_feedback(shown, "helpful", start + timedelta(days=3))
        self.assertEqual(StrategyRating.objects.get().rated_at, start)
        record_feedback(shown, "not_helpful", start + timedelta(days=4))
        rating = StrategyRating.objects.get()
        self.assertEqual((rating.value, rating.rated_at), ("not_helpful", start + timedelta(days=4)))
        record_feedback(shown, "not_helpful", start + timedelta(days=5))
        self.assertEqual(StrategyRating.objects.get().rated_at, start + timedelta(days=4))
        self.assertEqual(StrategyRating.objects.count(), 1)

    def test_rating_again_after_the_rest_is_over_starts_a_new_rest(self):
        strategy_id = self.first_technique()
        shown = ShownStrategy.objects.get(strategy_id=strategy_id)
        start = datetime(2026, 10, 1, 9, 0, tzinfo=dt_timezone.utc)
        record_feedback(shown, "not_helpful", start)
        later = start + timedelta(days=REST_DAYS + 2)
        self.assertEqual(record_feedback(shown, "tried", later)["rating"], None)
        self.assertEqual(record_feedback(shown, "not_helpful", later)["rating"], "not_helpful")
        self.assertEqual(StrategyRating.objects.get().rated_at, later)

    def test_tried_does_not_touch_ratings(self):
        strategy_id = self.first_technique()
        self.rate(strategy_id, "tried")
        self.assertFalse(StrategyRating.objects.exists())
        self.assertEqual(StrategyFeedback.objects.get().value, "tried")

    def test_the_feedback_log_for_7_1_is_written_as_before(self):
        strategy_id = self.first_technique()
        shown_id = self.rec(strategy_id)["shown_id"]
        for value in ("helpful", "not_helpful", "tried"):
            self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": value}, format="json")
        self.assertEqual(
            sorted(StrategyFeedback.objects.values_list("value", flat=True)), ["not_helpful", "tried"]
        )

    def test_a_row_whose_course_was_deleted_still_takes_feedback(self):
        strategy_id = self.first_technique()
        shown_id = self.rec(strategy_id)["shown_id"]
        self.course.delete()
        response = self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": "helpful"}, format="json")
        self.assertEqual(response.data, {"shown_id": shown_id, "rating": "helpful", "tried": False})
        self.assertFalse(StrategyRating.objects.exists())


class ResponseTests(RecommendationFeedbackBase):
    def test_the_rating_persists_into_the_next_week_and_tried_does_not(self):
        strategy_id = self.first_technique()
        self.rate(strategy_id, "helpful")
        self.rate(strategy_id, "tried")
        self.assertEqual(self.rec(strategy_id)["feedback"], {"rating": "helpful", "tried": True})

        next_week = timezone.now() + timedelta(days=8)
        with mock.patch.object(timezone, "now", return_value=next_week):
            rec = self.rec(strategy_id)
        self.assertEqual(rec["feedback"], {"rating": "helpful", "tried": False})
        self.assertEqual(ShownStrategy.objects.filter(strategy_id=strategy_id).count(), 2)

    def test_not_helpful_rests_the_strategy_and_another_takes_its_place(self):
        listing = self.listing()
        shown = [r["strategy_id"] for r in listing["recommendations"]]
        target = self.first_technique()
        self.assertEqual(listing["resting"], [])
        self.assertEqual(self.rate(target, "not_helpful", listing)["rating"], "not_helpful")

        after = self.listing()
        now = [r["strategy_id"] for r in after["recommendations"]]
        self.assertNotIn(target, now)
        self.assertEqual(len(now), len(shown))
        self.assertEqual(
            after["resting"],
            [
                {
                    "strategy_id": target,
                    "title": listing["recommendations"][shown.index(target)]["title"],
                    "until": (local_today() + timedelta(days=REST_DAYS)).isoformat(),
                }
            ],
        )

    def test_resting_strategies_are_not_logged_as_shown(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        before = ShownStrategy.objects.get(strategy_id=target)
        self.listing()
        self.listing()
        self.assertEqual(ShownStrategy.objects.get(strategy_id=target).times_shown, before.times_shown)

    def test_the_rest_ends_after_28_days(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        for days, back in ((27, False), (28, True), (29, True)):
            with mock.patch.object(timezone, "now", return_value=timezone.now() + timedelta(days=days)):
                listing = self.listing()
            self.assertEqual(self.rec(target, listing) is not None, back, days)
            self.assertEqual(bool(listing["resting"]), not back, days)
            if back:
                self.assertIsNone(self.rec(target, listing)["feedback"]["rating"])

    def test_a_course_with_everything_resting_has_no_recommendations(self):
        # Each round rests what is shown, and the next fitting strategies take their places.
        listing = self.listing()
        for _ in range(10):
            if not listing["recommendations"]:
                break
            for rec in listing["recommendations"]:
                self.rate(rec["strategy_id"], "not_helpful", listing)
            listing = self.listing()
        self.assertEqual(listing["recommendations"], [])
        self.assertGreater(len(listing["resting"]), 4)

    def test_ratings_belong_to_one_course(self):
        other = Course.objects.create(user=self.user, name="HIS 220", learning_demands=["writing", "conceptual"])
        target = self.first_technique()
        self.rate(target, "not_helpful")
        by_name = {c["course"]["name"]: c for c in self.client.get(URL).data["courses"]}
        self.assertIsNotNone(self.rec(target, by_name["HIS 220"]))
        self.assertEqual(by_name["HIS 220"]["resting"], [])
        self.assertEqual(other.strategy_ratings.count(), 0)


class ShowAgainTests(RecommendationFeedbackBase):
    def post(self, course_id, strategy_id):
        return self.client.post(SHOW_AGAIN_URL, {"course_id": course_id, "strategy_id": strategy_id}, format="json")

    def test_it_brings_the_strategy_back(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        self.assertIsNone(self.rec(target))

        response = self.post(self.course.id, target)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"course_id": self.course.id, "strategy_id": target, "rating": None})
        listing = self.listing()
        self.assertEqual(listing["resting"], [])
        self.assertEqual(self.rec(target, listing)["feedback"]["rating"], None)

    def test_it_can_be_rated_again_afterwards(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        self.post(self.course.id, target)
        self.assertEqual(self.rate(target, "not_helpful")["rating"], "not_helpful")
        self.assertIsNone(self.rec(target))
        self.post(self.course.id, target)
        self.assertEqual(self.rate(target, "helpful")["rating"], "helpful")
        self.assertEqual(StrategyRating.objects.get().cleared_at, None)

    def test_another_users_course_is_not_found(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        other = User.objects.create_user(username="other", password="TestPass123!")
        self.client.force_authenticate(other)
        self.assertEqual(self.post(self.course.id, target).status_code, 404)
        self.assertEqual(StrategyRating.objects.get().cleared_at, None)

    def test_no_rating_is_not_found(self):
        self.assertEqual(self.post(self.course.id, "retrieval_practice").status_code, 404)
        self.assertEqual(self.post(999999, "retrieval_practice").status_code, 404)

    def test_a_second_call_finds_nothing_to_clear(self):
        target = self.first_technique()
        self.rate(target, "not_helpful")
        self.assertEqual(self.post(self.course.id, target).status_code, 200)
        self.assertEqual(self.post(self.course.id, target).status_code, 404)

    def test_validation_and_authentication(self):
        self.assertEqual(self.client.post(SHOW_AGAIN_URL, {"strategy_id": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(SHOW_AGAIN_URL, {"course_id": 0, "strategy_id": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(SHOW_AGAIN_URL, {"course_id": self.course.id}, format="json").status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.post(self.course.id, "x").status_code, 401)


class StrategiesChangedTests(SavedPlanTestCase):
    def setUp(self):
        super().setUp()
        self.write_first_plan()

    def rating_target(self):
        listing = self.client.get(LIST_URL).data["courses"][0]
        return listing["recommendations"][0]

    def rate(self, value):
        rec = self.rating_target()
        response = self.client.post(FEEDBACK_URL, {"shown_id": rec["shown_id"], "value": value}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return rec["strategy_id"]

    def test_a_fresh_plan_has_no_strategy_changes(self):
        data = self.read()
        self.assertEqual((data["outdated"], data["strategies_changed"]), (False, False))

    def test_rating_a_strategy_outdates_the_plan_only_for_that_strategy_change(self):
        self.rate("helpful")
        data = self.read()
        self.assertEqual(
            (data["outdated"], data["strategies_changed"], data["new_sessions"], data["course_changed"]),
            (True, True, 0, False),
        )
        self.assertTrue(self.list_status()["Calculus"]["strategies_changed"])

    def test_show_again_counts_too(self):
        strategy_id = self.rate("not_helpful")
        self.write_after_change()
        self.assertFalse(self.read()["outdated"])
        self.clock.advance(minutes=5)
        response = self.client.post(SHOW_AGAIN_URL, {"course_id": self.course.id, "strategy_id": strategy_id}, format="json")
        self.assertEqual(response.status_code, 200)
        data = self.read()
        self.assertEqual((data["outdated"], data["strategies_changed"]), (True, True))

    def test_writing_the_plan_again_clears_it(self):
        self.rate("helpful")
        self.write_after_change()
        data = self.read()
        self.assertEqual((data["outdated"], data["strategies_changed"]), (False, False))

    def test_an_unchanged_repeat_rating_does_not(self):
        self.rate("helpful")
        self.write_after_change()
        self.clock.advance(minutes=5)
        self.rate("helpful")
        self.assertFalse(self.read()["outdated"])

    def test_the_status_of_a_plan_with_no_changes_has_the_field(self):
        self.assertIn("strategies_changed", self.read())

    def write_after_change(self):
        self.queue_next_plan()
        self.clock.advance(minutes=5)
        self.write()
        self.clock.advance(minutes=5)


LIST_URL = URL


class BackfillTests(TestCase):
    """Migration 0006 turns each user's latest rating feedback per course and strategy into a StrategyRating."""

    migration = importlib.import_module("apps.recommendations.migrations.0006_strategy_rating")

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="learner", password="TestPass123!")
        cls.other = User.objects.create_user(username="other", password="TestPass123!")
        cls.course = Course.objects.create(user=cls.user, name="Calculus")
        cls.second = Course.objects.create(user=cls.user, name="Algebra")
        cls.others_course = Course.objects.create(user=cls.other, name="Calculus")

    def shown(self, user, course, strategy_id, week):
        return ShownStrategy.objects.create(
            user=user,
            course=course,
            course_name=course.name if course else "Deleted",
            strategy_id=strategy_id,
            week_start=week,
            priority=60,
            basis="settings",
        )

    def feedback(self, shown, value, when):
        row = StrategyFeedback.objects.create(shown=shown, value=value)
        StrategyFeedback.objects.filter(pk=row.pk).update(updated_at=when)
        return row

    def test_takes_the_most_recent_rating_per_course_and_strategy(self):
        t = lambda day: datetime(2026, 9, day, 10, 0, tzinfo=dt_timezone.utc)  # noqa: E731
        week1 = self.shown(self.user, self.course, "retrieval_practice", date(2026, 9, 7))
        week2 = self.shown(self.user, self.course, "retrieval_practice", date(2026, 9, 14))
        self.feedback(week1, "helpful", t(8))
        self.feedback(week2, "not_helpful", t(16))
        self.feedback(week1, "tried", t(20))  # tried is not a rating, and not the latest rating
        only_helpful = self.shown(self.user, self.second, "retrieval_practice", date(2026, 9, 7))
        self.feedback(only_helpful, "helpful", t(9))
        tried_only = self.shown(self.user, self.course, "interleaving", date(2026, 9, 7))
        self.feedback(tried_only, "tried", t(9))
        theirs = self.shown(self.other, self.others_course, "retrieval_practice", date(2026, 9, 7))
        self.feedback(theirs, "helpful", t(10))
        orphan = self.shown(self.user, None, "retrieval_practice", date(2026, 9, 7))
        self.feedback(orphan, "not_helpful", t(11))

        self.migration.backfill_ratings(django_apps, None)

        got = {
            (r.user_id, r.course_id, r.strategy_id): (r.value, r.rated_at, r.updated_at, r.cleared_at)
            for r in StrategyRating.objects.all()
        }
        self.assertEqual(
            got,
            {
                (self.user.id, self.course.id, "retrieval_practice"): ("not_helpful", t(16), t(16), None),
                (self.user.id, self.second.id, "retrieval_practice"): ("helpful", t(9), t(9), None),
                (self.other.id, self.others_course.id, "retrieval_practice"): ("helpful", t(10), t(10), None),
            },
        )

    def test_it_reverses_by_deleting_the_ratings(self):
        StrategyRating.objects.create(user=self.user, course=self.course, strategy_id="x", value="helpful")
        self.migration.remove_ratings(django_apps, None)
        self.assertFalse(StrategyRating.objects.exists())


class ModelTests(TestCase):
    def test_one_rating_per_user_course_and_strategy(self):
        from django.db import IntegrityError, transaction

        user = User.objects.create_user(username="learner", password="TestPass123!")
        course = Course.objects.create(user=user, name="Calculus")
        StrategyRating.objects.create(user=user, course=course, strategy_id="interleaving", value="helpful")
        with self.assertRaises(IntegrityError), transaction.atomic():
            StrategyRating.objects.create(user=user, course=course, strategy_id="interleaving", value="not_helpful")
        StrategyRating.objects.create(user=user, course=course, strategy_id="worked_examples", value="helpful")

    def test_deleting_the_course_deletes_its_ratings(self):
        user = User.objects.create_user(username="learner", password="TestPass123!")
        course = Course.objects.create(user=user, name="Calculus")
        StrategyRating.objects.create(user=user, course=course, strategy_id="interleaving", value="helpful")
        course.delete()
        self.assertFalse(StrategyRating.objects.exists())

    def test_the_gatherer_loads_only_the_users_uncleared_ratings_for_the_course(self):
        user = User.objects.create_user(username="learner", password="TestPass123!")
        other = User.objects.create_user(username="other", password="TestPass123!")
        course = Course.objects.create(user=user, name="Calculus")
        elsewhere = Course.objects.create(user=user, name="Algebra")
        theirs = Course.objects.create(user=other, name="Calculus")
        StrategyRating.objects.create(user=user, course=course, strategy_id="interleaving", value="helpful")
        StrategyRating.objects.create(user=user, course=course, strategy_id="worked_examples", value="not_helpful")
        StrategyRating.objects.create(user=user, course=elsewhere, strategy_id="mock_exam", value="helpful")
        StrategyRating.objects.create(user=other, course=theirs, strategy_id="mock_exam", value="helpful")
        user_cleared = StrategyRating.objects.create(user=user, course=course, strategy_id="mock_exam", value="helpful")
        clear_rating(user, course, "mock_exam")
        self.assertIsNotNone(StrategyRating.objects.get(pk=user_cleared.pk).cleared_at)
        ratings = gather_course_data(user, course).ratings
        self.assertEqual({k: v.value for k, v in ratings.items()}, {"interleaving": "helpful", "worked_examples": "not_helpful"})
        self.assertEqual(ratings["interleaving"].rated_on, local_today())
