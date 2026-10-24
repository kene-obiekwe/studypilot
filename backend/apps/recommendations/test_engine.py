"""Pure tests of the recommendation engine: no database, CourseData built by hand."""

import re
from datetime import date, timedelta

from django.test import SimpleTestCase

from .engine import recommend
from .engine import diagnostics as dx
from .engine.diagnostics import CourseData, CourseTraits, ForecastInfo, PlanInfo, SessionRecord, WeekRecord
from .engine.library import LIBRARY
from .engine.selection import technique_order

TODAY = date(2026, 10, 24)  # a Saturday
NO_FORECAST = ForecastInfo("insufficient_history", None, 0)


def course(**overrides) -> CourseTraits:
    base = dict(
        id=1,
        name="Course",
        difficulty=3,
        learning_demands=(),
        builds_on_earlier=None,
        assessment_format="",
        exam_date=None,
    )
    base.update(overrides)
    return CourseTraits(**base)


def session(days_ago=1, planned=60, actual=None, focus=0.7, completion=0.7, adherence=0.8) -> SessionRecord:
    return SessionRecord(
        TODAY - timedelta(days=days_ago),
        planned,
        int(planned * adherence) if actual is None else actual,
        focus,
        completion,
        adherence,
    )


def data(sessions=(), course_traits=None, weeks=(), forecast=NO_FORECAST, plan=None, today=TODAY, total=None):
    sessions = tuple(sessions)
    return CourseData(
        course=course_traits or course(),
        today=today,
        sessions=sessions,
        total_sessions=len(sessions) if total is None else total,
        weeks=tuple(weeks),
        forecast=forecast,
        plan=plan,
    )


def ids(output) -> list[str]:
    return [rec["strategy_id"] for rec in output["recommendations"]]


def fired(course_data) -> list[str]:
    return [d.id for d in dx.run_diagnostics(course_data)]


def numbers(text: str) -> list[int]:
    return [int(n) for n in re.findall(r"\d+", text)]


# A history that triggers nothing by itself: 4 sessions, 2 days apart, all moderate.
CALM = [session(days_ago=d) for d in (1, 3, 5, 7)]


class InsufficientHistoryTests(SimpleTestCase):
    def test_fewer_than_three_sessions_is_insufficient(self):
        self.assertIn("insufficient_history", fired(data(CALM[:2])))

    def test_three_sessions_is_enough(self):
        self.assertNotIn("insufficient_history", fired(data(CALM[:3])))

    def test_session_based_patterns_need_three_sessions(self):
        poor = [session(days_ago=d, adherence=0.1, focus=0.1) for d in (1, 2)]
        result = fired(data(poor))
        self.assertNotIn("low_adherence", result)
        self.assertNotIn("low_focus", result)


class LongSessionTests(SimpleTestCase):
    def history(self, long_completion, short_completion, n_long=3, n_short=3, long_minutes=90):
        long = [session(days_ago=2 * i + 1, planned=long_minutes, completion=long_completion) for i in range(n_long)]
        short = [session(days_ago=2 * i + 2, planned=60, completion=short_completion) for i in range(n_short)]
        return data(long + short)

    def test_fires_at_the_gap_threshold(self):
        self.assertIn("long_sessions_finish_poorly", fired(self.history(0.55, 0.75)))

    def test_does_not_fire_just_below_the_gap(self):
        self.assertNotIn("long_sessions_finish_poorly", fired(self.history(0.56, 0.75)))

    def test_long_sessions_finishing_well_do_not_fire(self):
        self.assertNotIn("long_sessions_finish_poorly", fired(self.history(0.60, 0.95)))
        self.assertIn("long_sessions_finish_poorly", fired(self.history(0.59, 0.95)))

    def test_needs_three_sessions_on_each_side(self):
        self.assertNotIn("long_sessions_finish_poorly", fired(self.history(0.2, 0.9, n_long=2)))
        self.assertNotIn("long_sessions_finish_poorly", fired(self.history(0.2, 0.9, n_short=2)))

    def test_ninety_minutes_counts_as_long(self):
        self.assertIn("long_sessions_finish_poorly", fired(self.history(0.3, 0.8, long_minutes=90)))
        self.assertNotIn("long_sessions_finish_poorly", fired(self.history(0.3, 0.8, long_minutes=89)))

    def test_why_uses_the_users_numbers(self):
        result = dx.long_sessions_finish_poorly(self.history(0.35, 0.72, n_long=4, n_short=5))
        self.assertEqual(numbers(result.why), [90, 35, 4, 72, 5])
        self.assertIn("completion", result.why)
        self.assertEqual(result.facts["n_long"], 4)
        self.assertEqual(result.facts["long_minutes"], 90)


class SpacingTests(SimpleTestCase):
    def on_days(self, *days_ago):
        return data([session(days_ago=d) for d in days_ago])

    def test_fires_at_a_four_day_median_gap(self):
        self.assertIn("sparse_spacing", fired(self.on_days(1, 5, 9)))

    def test_three_day_gaps_do_not_fire(self):
        self.assertNotIn("sparse_spacing", fired(self.on_days(1, 4, 7)))

    def test_needs_three_study_days(self):
        self.assertNotIn("sparse_spacing", fired(self.on_days(1, 20)))
        # Two sessions on one day are one study day.
        self.assertNotIn("sparse_spacing", fired(self.on_days(1, 1, 20)))

    def test_why_reports_days_and_median_gap(self):
        result = dx.sparse_spacing(self.on_days(0, 6, 12, 19, 25))
        self.assertEqual(result.facts, {"study_days": 5, "median_gap_days": 6})
        self.assertIn("on 5 days in the last 4 weeks, usually 6 days apart", result.why)


class TrendAndForecastTests(SimpleTestCase):
    def weeks(self, *values, last_sessions=2):
        records = [WeekRecord(v, 2) for v in values]
        records[-1] = WeekRecord(values[-1], last_sessions)
        return records

    def test_decline_fires_at_the_threshold(self):
        self.assertIn("declining_trend", fired(data(CALM, weeks=self.weeks(0.8, 0.8, 0.6))))

    def test_smaller_drop_does_not_fire(self):
        self.assertNotIn("declining_trend", fired(data(CALM, weeks=self.weeks(0.8, 0.8, 0.61))))

    def test_decline_needs_three_complete_weeks(self):
        self.assertNotIn("declining_trend", fired(data(CALM, weeks=self.weeks(0.8, 0.1))))

    def test_decline_wording(self):
        dropped = dx.declining_trend(data(CALM, weeks=self.weeks(0.9, 0.7, 0.4)))
        self.assertEqual(numbers(dropped.why), [80, 40])
        empty = dx.declining_trend(data(CALM, weeks=self.weeks(0.9, 0.7, 0.0, last_sessions=0)))
        self.assertIn("didn't log any", empty.why)
        self.assertEqual(numbers(empty.why), [80])

    def test_low_forecast_threshold(self):
        self.assertIn("low_forecast", fired(data(CALM, forecast=ForecastInfo("ok", 0.49, 3))))
        self.assertNotIn("low_forecast", fired(data(CALM, forecast=ForecastInfo("ok", 0.50, 3))))

    def test_low_forecast_needs_a_model_forecast(self):
        self.assertNotIn("low_forecast", fired(data(CALM, forecast=ForecastInfo("model_unavailable", None, 3))))

    def test_low_forecast_why(self):
        result = dx.low_forecast(data(CALM, forecast=ForecastInfo("ok", 0.42, 5)))
        self.assertEqual(numbers(result.why), [5, 42])


class AdherenceAndFocusTests(SimpleTestCase):
    def test_low_adherence_threshold(self):
        self.assertIn("low_adherence", fired(data([session(days_ago=d, adherence=0.59) for d in (1, 3, 5)])))
        self.assertNotIn("low_adherence", fired(data([session(days_ago=d, adherence=0.60) for d in (1, 3, 5)])))

    def test_low_adherence_why_and_plan_size(self):
        sessions = [session(days_ago=d, planned=60, actual=24, adherence=0.4) for d in (1, 3, 5)]
        output = recommend(data(sessions))
        rec = next(r for r in output["recommendations"] if r["strategy_id"] == "right_size_plans")
        self.assertEqual(numbers(rec["why"]), [3, 40])
        self.assertEqual(rec["facts"]["plan_minutes"], 25)

    def test_low_focus_threshold(self):
        self.assertIn("low_focus", fired(data([session(days_ago=d, focus=0.49) for d in (1, 3, 5)])))
        self.assertNotIn("low_focus", fired(data([session(days_ago=d, focus=0.50) for d in (1, 3, 5)])))


class ExamTests(SimpleTestCase):
    def in_days(self, days, assessment_format="timed_problem_exam"):
        return data(CALM, course_traits=course(exam_date=TODAY + timedelta(days=days), assessment_format=assessment_format))

    def test_window_boundaries(self):
        self.assertEqual([d for d in fired(self.in_days(22)) if d.startswith("exam")], [])
        self.assertIn("exam_soon", fired(self.in_days(21)))
        self.assertIn("exam_soon", fired(self.in_days(8)))
        self.assertIn("exam_imminent", fired(self.in_days(7)))
        self.assertNotIn("exam_soon", fired(self.in_days(7)))
        self.assertIn("exam_imminent", fired(self.in_days(0)))
        self.assertEqual([d for d in fired(self.in_days(-1)) if d.startswith("exam")], [])

    def test_wording(self):
        self.assertEqual(dx.exam_soon(self.in_days(18)).why, "Your exam is in 18 days and it's a timed problem exam.")
        self.assertEqual(dx.exam_soon(self.in_days(10, "essay_exam")).why, "Your exam is in 10 days and it's an essay exam.")
        self.assertEqual(dx.exam_soon(self.in_days(10, "coursework")).why, "Your coursework is due in 10 days.")
        self.assertEqual(dx.exam_imminent(self.in_days(1, "")).why, "Your exam is in 1 day.")
        self.assertEqual(dx.exam_imminent(self.in_days(0)).why, "Your exam is today.")


class UnderStudiedTests(SimpleTestCase):
    WEDNESDAY = date(2026, 10, 21)
    TUESDAY = date(2026, 10, 20)

    def check(self, today, allocated, logged):
        return fired(data(CALM, plan=PlanInfo(allocated, logged), today=today))

    def test_fires_from_the_third_day_of_the_week(self):
        # Wednesday: expected 7 h * 3/7 = 3 h, half of that is 1.5 h.
        self.assertIn("under_studied", self.check(self.WEDNESDAY, 7, 1.4))
        self.assertNotIn("under_studied", self.check(self.TUESDAY, 7, 0))

    def test_logging_half_the_pace_is_on_track(self):
        self.assertNotIn("under_studied", self.check(self.WEDNESDAY, 7, 1.5))

    def test_small_allocations_are_ignored(self):
        self.assertNotIn("under_studied", self.check(self.WEDNESDAY, 2, 0))  # expected 0.86 h < 1 h

    def test_needs_a_plan(self):
        self.assertNotIn("under_studied", fired(data(CALM, today=self.WEDNESDAY)))

    def test_why(self):
        result = dx.under_studied(data(CALM, plan=PlanInfo(7, 1), today=self.WEDNESDAY, course_traits=course(name="CSC 401")))
        self.assertEqual(
            result.why,
            "This week's plan gives CSC 401 7 h. By Wednesday you've logged 1 h, against about 3 h to be on track.",
        )


class TechniqueSelectionTests(SimpleTestCase):
    def order(self, **traits):
        return [strategy for strategy, _ in technique_order(data(course_traits=course(**traits)))]

    def test_problem_solving(self):
        self.assertEqual(self.order(learning_demands=("problem_solving",)), ["worked_examples", "interleaving", "retrieval_practice"])

    def test_each_demand_maps_to_its_techniques(self):
        self.assertEqual(self.order(learning_demands=("memorisation",)), ["flashcard_self_testing"])
        self.assertEqual(self.order(learning_demands=("practical",)), ["deliberate_practice"])
        self.assertEqual(self.order(learning_demands=("writing",)), ["plan_then_write", "retrieval_practice"])
        self.assertEqual(self.order(learning_demands=("conceptual",)), ["self_explanation", "elaborative_interrogation"])

    def test_no_demands_falls_back_to_retrieval_practice(self):
        self.assertEqual(self.order(), ["retrieval_practice"])

    def test_demands_round_robin_with_warmup_after_the_primaries(self):
        self.assertEqual(
            self.order(learning_demands=("conceptual", "problem_solving"), builds_on_earlier=True),
            ["self_explanation", "worked_examples", "prerequisite_warmup", "elaborative_interrogation", "interleaving", "retrieval_practice"],
        )

    def test_difficult_courses_put_worked_examples_first(self):
        self.assertEqual(self.order(learning_demands=("conceptual", "problem_solving"), difficulty=4)[0], "worked_examples")
        self.assertEqual(self.order(learning_demands=("conceptual", "problem_solving"), difficulty=3)[0], "self_explanation")

    def test_warmup_gets_its_own_slot_when_free(self):
        output = recommend(data(course_traits=course(learning_demands=("problem_solving",), builds_on_earlier=True)))
        self.assertIn("prerequisite_warmup", ids(output))

    def test_warmup_becomes_a_step_when_no_slot_is_free(self):
        # Exam + 2 behaviour strategies leave one technique slot.
        sessions = [session(days_ago=d, adherence=0.3, focus=0.3) for d in (1, 6, 11, 16)]
        traits = course(
            learning_demands=("problem_solving",), builds_on_earlier=True, difficulty=5, exam_date=TODAY + timedelta(days=5)
        )
        output = recommend(data(sessions, course_traits=traits))
        self.assertEqual(len(output["recommendations"]), 4)
        self.assertNotIn("prerequisite_warmup", ids(output))
        top = next(r for r in output["recommendations"] if r["kind"] == "technique")
        self.assertEqual(top["strategy_id"], "worked_examples")
        self.assertIn("earlier topic", top["how"][0])
        self.assertTrue(top["facts"]["warmup_step"])

    def test_retrieval_variants_follow_the_demand(self):
        essay = recommend(data(course_traits=course(learning_demands=("writing",))))
        retrieval = next(r for r in essay["recommendations"] if r["strategy_id"] == "retrieval_practice")
        self.assertIn("blank page", retrieval["how"][0])

    def test_continuous_quizzes_always_get_format_practice(self):
        output = recommend(data(CALM, course_traits=course(assessment_format="continuous_quizzes")))
        rec = output["recommendations"][0]
        self.assertEqual((rec["strategy_id"], rec["kind"]), ("format_matched_practice", "exam"))
        self.assertIn("quiz", rec["what"].lower())

    def test_format_practice_only_near_the_exam_otherwise(self):
        far = recommend(data(CALM, course_traits=course(assessment_format="essay_exam", exam_date=TODAY + timedelta(days=40))))
        self.assertNotIn("format_matched_practice", ids(far))
        near = recommend(data(CALM, course_traits=course(assessment_format="essay_exam", exam_date=TODAY + timedelta(days=12))))
        rec = next(r for r in near["recommendations"] if r["strategy_id"] == "format_matched_practice")
        self.assertIn("essay plans", rec["what"])


class SelectionRuleTests(SimpleTestCase):
    def everything_wrong(self, **traits):
        sessions = [session(days_ago=d, adherence=0.3, focus=0.3, completion=0.2) for d in (1, 6, 11, 16, 21)]
        weeks = [WeekRecord(0.9, 2), WeekRecord(0.8, 2), WeekRecord(0.2, 1)]
        return data(sessions, weeks=weeks, forecast=ForecastInfo("ok", 0.3, 3), course_traits=course(**traits))

    def test_never_more_than_four_and_always_a_technique(self):
        output = recommend(self.everything_wrong(exam_date=TODAY + timedelta(days=3), learning_demands=("writing",)))
        kinds = [r["kind"] for r in output["recommendations"]]
        self.assertEqual(len(kinds), 4)
        self.assertEqual(kinds.count("exam"), 1)
        self.assertEqual(sum(k in ("schedule", "habit", "focus") for k in kinds), 2)
        self.assertEqual(kinds.count("technique"), 1)

    def test_mock_exam_beats_format_practice(self):
        output = recommend(self.everything_wrong(exam_date=TODAY + timedelta(days=3), assessment_format="continuous_quizzes"))
        exam = [r["strategy_id"] for r in output["recommendations"] if r["kind"] == "exam"]
        self.assertEqual(exam, ["mock_exam"])

    def test_triggers_pointing_to_one_strategy_merge(self):
        sessions = [session(days_ago=d) for d in (1, 3, 5)]
        weeks = [WeekRecord(0.9, 2), WeekRecord(0.9, 2), WeekRecord(0.5, 1)]
        output = recommend(data(sessions, weeks=weeks, forecast=ForecastInfo("ok", 0.4, 3)))
        recs = [r for r in output["recommendations"] if r["strategy_id"] == "implementation_intentions"]
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["triggers"], ["declining_trend", "low_forecast"])
        self.assertIn("dropped", recs[0]["why"])  # the higher-priority trigger's sentence
        self.assertEqual(recs[0]["facts"]["predicted_adherence"], 0.4)

    def test_output_is_sorted_by_priority_and_deterministic(self):
        first = recommend(self.everything_wrong(learning_demands=("problem_solving",)))
        second = recommend(self.everything_wrong(learning_demands=("problem_solving",)))
        self.assertEqual(first, second)
        priorities = [r["priority"] for r in first["recommendations"]]
        self.assertEqual(priorities, sorted(priorities))

    def test_every_recommendation_is_fully_displayable(self):
        output = recommend(self.everything_wrong(exam_date=TODAY + timedelta(days=12), learning_demands=("writing",)))
        for rec in output["recommendations"]:
            for field in ("strategy_id", "kind", "title", "what", "why"):
                self.assertTrue(rec[field], (rec["strategy_id"], field))
            self.assertTrue(rec["how"])
            self.assertTrue(rec["source"]["citation"] and rec["source"]["short"])

    def test_source_notes(self):
        self.assertIn("mixed", LIBRARY["phone_out_of_room"].source.as_dict()["note"])
        self.assertEqual(LIBRARY["plan_then_write"].source.as_dict()["note"], "Meta-analysis of school-age writers.")
        self.assertNotIn("note", LIBRARY["worked_examples"].source.as_dict())

    def test_split_long_sessions_keeps_total_time(self):
        long = [session(days_ago=2 * i + 1, planned=105, completion=0.3) for i in range(3)]
        short = [session(days_ago=2 * i + 2, planned=45, completion=0.8) for i in range(3)]
        for difficulty, block, n_blocks in ((3, 45, 3), (4, 30, 4)):
            output = recommend(data(long + short, course_traits=course(difficulty=difficulty)))
            rec = next(r for r in output["recommendations"] if r["strategy_id"] == "split_long_sessions")
            self.assertEqual((rec["facts"]["block_minutes"], rec["facts"]["n_blocks"]), (block, n_blocks))
            self.assertIn(f"105-minute session with {n_blocks} sessions of {block} minutes", rec["how"][0])


class EvidenceTests(SimpleTestCase):
    def test_no_history_is_settings_only(self):
        output = recommend(data(course_traits=course(learning_demands=("conceptual",))))
        self.assertEqual(output["evidence"]["basis"], "settings")
        self.assertEqual(output["evidence"]["summary"], "Based on your course settings only")
        self.assertTrue(all(r["basis"] == "settings" for r in output["recommendations"]))
        self.assertEqual(output["recommendations"][-1]["strategy_id"], "spaced_schedule")

    def test_history_summary_counts_sessions_and_weeks(self):
        output = recommend(data([session(days_ago=d) for d in (1, 9, 20)]))
        self.assertEqual(output["evidence"]["summary"], "Based on 3 sessions over 3 weeks")
        self.assertEqual(output["evidence"]["basis"], "history")

    def test_older_history_with_few_recent_sessions(self):
        weeks = [WeekRecord(0.9, 2), WeekRecord(0.9, 2), WeekRecord(0.0, 0)]
        output = recommend(data([session(days_ago=10)], weeks=weeks, total=9))
        self.assertIn("declining_trend", output["evidence"]["diagnostics"])
        self.assertEqual(output["evidence"]["summary"], "Based on 9 sessions logged so far and your course settings")


def calculus() -> CourseData:
    """Worked example A from the design note."""
    days = [TODAY - timedelta(days=d) for d in (25, 19, 13, 6, 0)]
    specs = [
        (days[0], 90, 0.30), (days[0], 60, 0.70), (days[1], 90, 0.40), (days[1], 45, 0.75),
        (days[2], 90, 0.35), (days[3], 60, 0.70), (days[3], 90, 0.35), (days[4], 60, 0.73),
    ]
    sessions = [SessionRecord(day, planned, int(planned * 0.7), 0.65, completion, 0.7) for day, planned, completion in specs]
    traits = course(
        name="Calculus",
        difficulty=5,
        learning_demands=("problem_solving",),
        builds_on_earlier=True,
        assessment_format="timed_problem_exam",
        exam_date=TODAY + timedelta(days=18),
    )
    weeks = [WeekRecord(0.7, 2), WeekRecord(0.7, 1), WeekRecord(0.7, 2), WeekRecord(0.68, 2)]
    return data(sessions, course_traits=traits, weeks=weeks, forecast=ForecastInfo("ok", 0.68, 4))


def history_course() -> CourseData:
    """Worked example B: writing-heavy, essay exam, no history."""
    traits = course(
        name="HIS 210 Modern European History",
        learning_demands=("writing", "conceptual"),
        builds_on_earlier=False,
        assessment_format="essay_exam",
    )
    return data(course_traits=traits)


class GoldenStructureTests(SimpleTestCase):
    def test_calculus(self):
        output = recommend(calculus())
        self.assertEqual(
            [(r["strategy_id"], r["kind"], r["basis"]) for r in output["recommendations"]],
            [
                ("format_matched_practice", "exam", "settings"),
                ("split_long_sessions", "schedule", "history"),
                ("spaced_schedule", "schedule", "history"),
                ("worked_examples", "technique", "settings"),
            ],
        )
        evidence = output["evidence"]
        self.assertEqual(evidence["summary"], "Based on 8 sessions over 4 weeks")
        self.assertEqual(evidence["diagnostics"], ["exam_soon", "long_sessions_finish_poorly", "sparse_spacing"])
        self.assertEqual(evidence["exam_in_days"], 18)

        exam, split, spaced, worked = output["recommendations"]
        self.assertEqual(numbers(exam["why"]), [18])
        self.assertEqual(split["facts"]["n_blocks"], 3)
        self.assertEqual(split["facts"]["block_minutes"], 30)
        self.assertEqual(numbers(split["why"]), [90, 35, 4, 72, 4])
        self.assertEqual(numbers(spaced["why"]), [5, 4, 6])  # 5 days, last 4 weeks, 6 days apart
        self.assertEqual(worked["facts"]["block_minutes"], 30)
        self.assertTrue(worked["facts"]["warmup_step"])

    def test_why_numbers_match_facts(self):
        output = recommend(calculus())
        split = next(r for r in output["recommendations"] if r["strategy_id"] == "split_long_sessions")
        facts = split["facts"]
        self.assertEqual(
            numbers(split["why"]),
            [90, dx.pct(facts["long_mean_completion"]), facts["n_long"], dx.pct(facts["short_mean_completion"]), facts["n_short"]],
        )

    def test_history_course(self):
        output = recommend(history_course())
        self.assertEqual(
            [(r["strategy_id"], r["kind"]) for r in output["recommendations"]],
            [
                # Each demand's best technique first (writing, conceptual), then writing's second.
                ("plan_then_write", "technique"),
                ("self_explanation", "technique"),
                ("retrieval_practice", "technique"),
                ("spaced_schedule", "schedule"),
            ],
        )
        self.assertEqual(output["evidence"]["summary"], "Based on your course settings only")
        self.assertEqual(output["evidence"]["diagnostics"], ["insufficient_history"])
        self.assertTrue(all(r["basis"] == "settings" for r in output["recommendations"]))
        self.assertEqual(output["recommendations"][0]["source"]["note"], "Meta-analysis of school-age writers.")
        for rec in output["recommendations"]:
            self.assertEqual(numbers(rec["why"]), [210] if "HIS 210" in rec["why"] else [])

    def test_the_two_examples_share_no_strategy_but_spacing(self):
        a, b = set(ids(recommend(calculus()))), set(ids(recommend(history_course())))
        self.assertEqual(a & b, {"spaced_schedule"})
