"""One plan per week: the catch-up split, the /plans/ API and course hooks.

The worked examples are the ones in the 5.8b design note: plan A 7 h / B 3 h, logged A 4 h and
B 1 h by Wednesday 28 October 2026 (week of Monday 26 October).
"""

import random
from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest import mock

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from apps.tracking import inference
from apps.tracking.models import StudySessionLog

from .models import Course, StudyPlan
from .services import catch_up_split

WEDNESDAY = datetime(2026, 10, 28, 12, 0, tzinfo=dt_timezone.utc)
SUNDAY_EVENING = datetime(2026, 11, 1, 20, 0, tzinfo=dt_timezone.utc)
MONDAY = date(2026, 10, 26)
NEXT_MONDAY = date(2026, 11, 2)


def split(more, **courses):
    """courses: name=(difficulty, factor, logged) -> {name: (target, remaining, planned)}."""
    rows = catch_up_split(more, [{"name": n, "difficulty": d, "factor": f, "logged": l} for n, (d, f, l) in courses.items()])
    return {row["name"]: (row["target_hours"], row["remaining_hours"], row["planned_hours"]) for row in rows}


def cents(hours):
    return round(hours * 100)


class CatchUpSplitTests(SimpleTestCase):
    def test_example_1_harder_a_new_c_total_14(self):
        self.assertEqual(split(10, A=(5, 1.0, 4), C=(2, 1.0, 0)), {"A": (10.0, 6.0, 10.0), "C": (4.0, 4.0, 4.0)})

    def test_example_1_with_a_1_1_factor(self):
        self.assertEqual(split(10, A=(5, 1.1, 4), C=(2, 1.0, 0)), {"A": (10.27, 6.27, 10.27), "C": (3.73, 3.73, 3.73)})

    def test_example_2_new_courses_default_and_lowered(self):
        self.assertEqual(split(10, D=(4, 1.0, 0), E=(2, 1.0, 0)), {"D": (6.67, 6.67, 6.67), "E": (3.33, 3.33, 3.33)})
        self.assertEqual(split(6, D=(4, 1.0, 0), E=(2, 1.0, 0)), {"D": (4.0, 4.0, 4.0), "E": (2.0, 2.0, 2.0)})

    def test_example_3a_course_past_its_share_gets_nothing(self):
        self.assertEqual(split(1, A=(3, 1.0, 4), B=(3, 1.0, 1)), {"A": (3.0, 0.0, 4.0), "B": (3.0, 1.0, 2.0)})

    def test_example_3b_more_zero_is_week_complete(self):
        self.assertEqual(split(0, A=(3, 1.0, 4), B=(3, 1.0, 1)), {"A": (2.5, 0.0, 4.0), "B": (2.5, 0.0, 1.0)})

    def test_example_4_fresh_week(self):
        self.assertEqual(split(12, A=(4, 1.0, 0), B=(2, 1.0, 0)), {"A": (8.0, 8.0, 8.0), "B": (4.0, 4.0, 4.0)})

    def test_rounding_goes_to_the_largest_fraction_and_sums_exactly(self):
        self.assertEqual(
            split(10, X=(3, 1.0, 0), Y=(3, 1.0, 0), Z=(3, 1.0, 0)),
            {"X": (3.33, 3.34, 3.34), "Y": (3.33, 3.33, 3.33), "Z": (3.33, 3.33, 3.33)},
        )

    def test_no_logs_matches_the_difficulty_share(self):
        self.assertEqual(split(9, A=(1, 1.0, 0), B=(2, 1.0, 0)), {"A": (3.0, 3.0, 3.0), "B": (6.0, 6.0, 6.0)})

    def test_every_course_past_its_share(self):
        self.assertEqual(split(0, A=(1, 1.0, 5), B=(1, 1.0, 5)), {"A": (5.0, 0.0, 5.0), "B": (5.0, 0.0, 5.0)})

    def test_remaining_sums_to_more_exactly_and_is_never_negative(self):
        rng = random.Random(58)
        for _ in range(500):
            count = rng.randint(2, 6)
            more = round(rng.uniform(0, 40), 2)
            rows = catch_up_split(
                more,
                [
                    {
                        "name": f"C{i}",
                        "difficulty": rng.randint(1, 5),
                        "factor": rng.choice([0.8, 0.9, 1.0, 1.1]),
                        "logged": round(rng.choice([0, 0, rng.uniform(0, 12)]), 2),
                    }
                    for i in range(count)
                ],
            )
            with self.subTest(more=more, rows=rows):
                self.assertEqual(sum(cents(row["remaining_hours"]) for row in rows), cents(more))
                self.assertTrue(all(row["remaining_hours"] >= 0 for row in rows))


class WeeklyPlanApiTestCase(APITestCase):
    now = WEDNESDAY

    def setUp(self):
        # A fixed clock, and no forecast model: adjustments come from the 30-day mean only.
        for patcher in (
            mock.patch("django.utils.timezone.now", return_value=self.now),
            mock.patch.object(inference, "get_model", return_value=None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="weekly", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def course(self, name, difficulty=3):
        return Course.objects.create(user=self.user, name=name, difficulty=difficulty)

    def log(self, name, hours, at):
        # adherence 0.75 gives the 30-day mean a factor of 1.0, so the examples' weights are difficulties.
        log = StudySessionLog.objects.create(
            user=self.user,
            course_name=name,
            planned_minutes=int(hours * 60),
            actual_minutes=int(hours * 60),
            adherence_score=0.75,
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=at)

    def start_week(self):
        """The examples' starting point: a first-version plan A 7 / B 3 made on Monday, A 4 h and B 1 h logged."""
        self.a, self.b = self.course("A", 4), self.course("B", 3)
        plan = StudyPlan.objects.create(
            user=self.user,
            week_start=MONDAY,
            plan_json={
                "total_available_hours": 10,
                "courses": [{"name": "A", "difficulty": 4}, {"name": "B", "difficulty": 3}],
                "allocations": [
                    {"course": "A", "allocated_hours": 7, "focus_block_minutes": 50, "break_minutes": 10},
                    {"course": "B", "allocated_hours": 3, "focus_block_minutes": 50, "break_minutes": 10},
                ],
            },
        )
        self.log("A", 2, datetime(2026, 10, 26, 9, tzinfo=dt_timezone.utc))
        self.log("A", 2, datetime(2026, 10, 27, 9, tzinfo=dt_timezone.utc))
        self.log("B", 1, datetime(2026, 10, 27, 15, tzinfo=dt_timezone.utc))
        return plan

    def preview(self, week, courses, **hours):
        return self.client.post(
            "/api/planner/plans/preview/", {"week_start": week, "courses": courses, **hours}, format="json"
        )

    def put(self, week, courses, **hours):
        return self.client.put(f"/api/planner/plans/{week}/", {"courses": courses, **hours}, format="json")

    def by_name(self, plan_json):
        return {c["name"]: c for c in plan_json["courses"]}


class WorkedExampleApiTests(WeeklyPlanApiTestCase):
    def test_example_1_preview_then_save(self):
        self.start_week()
        self.course("C", 2)
        courses = [{"name": "A", "difficulty": 5}, {"name": "C", "difficulty": 2}]

        preview = self.preview("2026-10-26", courses, more_hours=10, base_revision=1)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(StudyPlan.objects.count(), 1)  # nothing saved
        self.assertEqual(preview.data["days_left"], 5)
        self.assertEqual(preview.data["base_revision"], 1)
        data = preview.data["plan_json"]
        self.assertEqual((data["counted_hours"], data["more_hours"], data["total_hours"]), (4.0, 10.0, 14.0))
        entries = self.by_name(data)
        self.assertEqual(
            {n: (e["logged_at_revision"], e["remaining_at_revision"], e["planned_hours"]) for n, e in entries.items()},
            {"A": (4.0, 6.0, 10.0), "C": (0.0, 4.0, 4.0)},
        )
        self.assertEqual(entries["A"]["entered_on"], "2026-10-26")
        self.assertEqual(entries["C"]["entered_on"], "2026-10-28")
        self.assertEqual(data["removed"], [{"course_id": None, "name": "B", "removed_on": "2026-10-28", "logged_hours": 1.0}])
        self.assertEqual({a["course"]: a["allocated_hours"] for a in data["allocations"]}, {"A": 10.0, "C": 4.0})
        self.assertEqual(data["total_available_hours"], 14.0)

        saved = self.put("2026-10-26", courses, more_hours=10, base_revision=1)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual((saved.data["revision"], saved.data["revision_count"], saved.data["is_current"]), (2, 2, True))
        old, new = StudyPlan.objects.order_by("revision")
        self.assertFalse(old.is_current)
        self.assertEqual(old.superseded_at, WEDNESDAY)
        self.assertEqual(old.plan_json["allocations"][0]["allocated_hours"], 7)  # history untouched
        self.assertEqual(new.plan_json["mode"], "update")
        self.assertEqual(Course.objects.get(user=self.user, name="A").weekly_target_hours, 10.0)
        self.assertEqual(Course.objects.get(user=self.user, name="A").difficulty, 5)

    def test_example_2_both_replaced_on_wednesday(self):
        self.start_week()
        self.course("D", 4), self.course("E", 2)
        courses = [{"name": "D", "difficulty": 4}, {"name": "E", "difficulty": 2}]
        default = self.preview("2026-10-26", courses, more_hours=10, base_revision=1).data["plan_json"]
        self.assertEqual(default["counted_hours"], 0.0)
        self.assertEqual({n: e["planned_hours"] for n, e in self.by_name(default).items()}, {"D": 6.67, "E": 3.33})
        self.assertEqual({e["entered_on"] for e in default["courses"]}, {"2026-10-28"})
        self.assertEqual([(r["name"], r["logged_hours"]) for r in default["removed"]], [("A", 4.0), ("B", 1.0)])
        lowered = self.preview("2026-10-26", courses, more_hours=6, base_revision=1).data["plan_json"]
        self.assertEqual({n: e["planned_hours"] for n, e in self.by_name(lowered).items()}, {"D": 4.0, "E": 2.0})
        self.assertEqual(lowered["total_hours"], 6.0)

    def test_example_3a_split_3_3(self):
        self.start_week()
        courses = [{"name": "A", "difficulty": 3}, {"name": "B", "difficulty": 3}]
        data = self.preview("2026-10-26", courses, more_hours=1, base_revision=1).data["plan_json"]
        entries = self.by_name(data)
        self.assertEqual((entries["A"]["remaining_at_revision"], entries["A"]["planned_hours"]), (0.0, 4.0))
        self.assertEqual((entries["B"]["remaining_at_revision"], entries["B"]["planned_hours"]), (1.0, 2.0))
        self.assertEqual(data["total_hours"], 6.0)

    def test_example_3b_first_plan_with_a_total_below_hours_done_is_clamped(self):
        # The only way to give a total (rather than "more") is a first plan; a total below the hours
        # already counted is clamped to what is done: more = 0, so the week is complete.
        self.course("A", 3), self.course("B", 3)
        self.log("A", 2, datetime(2026, 10, 26, 9, tzinfo=dt_timezone.utc))
        self.log("A", 2, datetime(2026, 10, 27, 9, tzinfo=dt_timezone.utc))
        self.log("B", 1, datetime(2026, 10, 27, 15, tzinfo=dt_timezone.utc))
        courses = [{"name": "A", "difficulty": 3}, {"name": "B", "difficulty": 3}]

        preview = self.preview("2026-10-26", courses, total_hours=4)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertTrue(preview.data["clamped"])
        self.assertEqual(StudyPlan.objects.count(), 0)

        response = self.put("2026-10-26", courses, total_hours=4)
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["plan_json"]
        self.assertEqual({a["course"]: a["allocated_hours"] for a in data["allocations"]}, {"A": 4.0, "B": 1.0})
        self.assertEqual((data["more_hours"], data["clamped"], data["total_hours"]), (0.0, True, 5.0))
        self.assertEqual([e["remaining_at_revision"] for e in data["courses"]], [0.0, 0.0])
        self.assertEqual(StudyPlan.objects.get(is_current=True).revision, 1)

    def test_more_zero_through_the_api(self):
        self.start_week()
        courses = [{"name": "A", "difficulty": 3}, {"name": "B", "difficulty": 3}]
        data = self.preview("2026-10-26", courses, more_hours=0, base_revision=1).data["plan_json"]
        self.assertEqual([e["remaining_at_revision"] for e in data["courses"]], [0.0, 0.0])
        self.assertEqual(data["total_hours"], 5.0)


class SundayTests(WeeklyPlanApiTestCase):
    now = SUNDAY_EVENING

    def test_example_4_plan_next_week_on_sunday(self):
        this_week = self.start_week()
        response = self.put(
            "2026-11-02", [{"name": "A", "difficulty": 4}, {"name": "B", "difficulty": 2}], total_hours=12
        )
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["plan_json"]
        self.assertEqual({n: e["planned_hours"] for n, e in self.by_name(data).items()}, {"A": 8.0, "B": 4.0})
        self.assertEqual({e["entered_on"] for e in data["courses"]}, {"2026-11-02"})
        self.assertEqual(data["counted_hours"], 0.0)
        self.assertEqual(response.data["days_left"], 7)
        this_week.refresh_from_db()
        self.assertTrue(this_week.is_current)
        self.assertEqual(StudyPlan.objects.filter(is_current=True).count(), 2)

    def test_this_week_on_sunday_has_one_day_left(self):
        self.start_week()
        response = self.client.get("/api/planner/plans/2026-10-26/")
        self.assertEqual(response.data["days_left"], 1)


class PlanRulesTests(WeeklyPlanApiTestCase):
    def test_first_plan_then_list_and_detail(self):
        response = self.put("2026-10-26", [{"name": "A", "difficulty": 3}], total_hours=6)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data["revision"], response.data["revision_count"]), (1, 1))
        self.assertEqual(response.data["plan_json"]["mode"], "first")
        self.assertEqual(Course.objects.get(user=self.user).name, "A")  # new names become courses, as before
        listed = self.client.get("/api/planner/plans/").data["items"]
        self.assertEqual([(item["week_start"], item["revision_count"]) for item in listed], [("2026-10-26", 1)])
        detail = self.client.get("/api/planner/plans/2026-10-26/")
        self.assertEqual((detail.status_code, detail.data["days_left"]), (200, 5))
        self.assertEqual(self.client.get("/api/planner/plans/2026-10-19/").status_code, 404)

    def test_first_plan_mid_week_counts_hours_already_logged(self):
        self.course("A", 3)
        self.log("A", 2, datetime(2026, 10, 26, 9, tzinfo=dt_timezone.utc))
        data = self.put("2026-10-26", [{"name": "A", "difficulty": 3}], total_hours=6).data["plan_json"]
        self.assertEqual((data["counted_hours"], data["more_hours"], data["total_hours"]), (2.0, 4.0, 6.0))

    def test_conflicts(self):
        courses = [{"name": "A", "difficulty": 3}]
        self.put("2026-10-26", courses, total_hours=6)
        exists = self.put("2026-10-26", courses, total_hours=6)
        self.assertEqual((exists.status_code, exists.data["code"], exists.data["current_revision"]), (409, "plan_exists", 1))
        self.assertEqual(self.put("2026-10-26", courses, more_hours=2, base_revision=1).status_code, 200)
        stale = self.put("2026-10-26", courses, more_hours=2, base_revision=1)
        self.assertEqual((stale.status_code, stale.data["code"], stale.data["current_revision"]), (409, "plan_changed", 2))
        self.assertEqual(self.preview("2026-10-26", courses, total_hours=6).data["code"], "plan_exists")
        self.assertEqual(self.preview("2026-10-26", courses, more_hours=1, base_revision=1).data["code"], "plan_changed")
        missing = self.put("2026-11-02", courses, more_hours=1, base_revision=1)
        self.assertEqual((missing.status_code, missing.data["code"]), (409, "plan_changed"))
        self.assertEqual(StudyPlan.objects.count(), 2)

    def test_hours_fields_must_match_the_mode(self):
        courses = [{"name": "A", "difficulty": 3}]
        self.assertEqual(self.put("2026-10-26", courses).status_code, 400)
        self.assertEqual(self.put("2026-10-26", courses, total_hours=6, more_hours=1).status_code, 400)
        self.assertIn("more_hours", self.put("2026-10-26", courses, more_hours=6).data)
        self.assertIn("total_hours", self.put("2026-10-26", courses, total_hours=6, base_revision=1).data)
        self.assertEqual(self.put("2026-10-26", courses, total_hours="nan").status_code, 400)

    def test_week_cannot_exceed_168_hours_including_hours_done(self):
        self.start_week()
        response = self.put("2026-10-26", [{"name": "A", "difficulty": 3}], more_hours=165, base_revision=1)
        self.assertEqual(response.status_code, 400)
        self.assertIn("more_hours", response.data)

    def test_week_start_is_validated(self):
        courses = [{"name": "A", "difficulty": 3}]
        for week in ("2026-10-27", "2026-11-09", "2026-10-19", "2026-10-12", "26-10-2026"):
            with self.subTest(week=week):
                self.assertEqual(self.put(week, courses, total_hours=5).status_code, 400)
        for week in ("2026-10-26", "2026-11-02"):  # this week and next week only
            with self.subTest(week=week):
                self.assertEqual(self.put(week, courses, total_hours=5).status_code, 200)
        self.assertEqual(self.preview("2026-11-09", courses, total_hours=5).status_code, 400)

    def test_a_removed_course_added_back_gets_its_logs_back(self):
        self.start_week()
        self.course("C", 2)
        self.put("2026-10-26", [{"name": "A", "difficulty": 5}, {"name": "C", "difficulty": 2}], more_hours=10, base_revision=1)
        again = self.put(
            "2026-10-26",
            [{"name": "A", "difficulty": 5}, {"name": "b", "difficulty": 3}, {"name": "C", "difficulty": 2}],
            more_hours=5,
            base_revision=2,
        ).data["plan_json"]
        entries = self.by_name(again)
        self.assertEqual(entries["B"]["logged_at_revision"], 1.0)
        self.assertEqual(entries["B"]["entered_on"], "2026-10-28")
        self.assertEqual(again["removed"], [])
        self.assertEqual(again["counted_hours"], 5.0)

    def test_one_current_plan_per_week_is_enforced(self):
        StudyPlan.objects.create(user=self.user, week_start=MONDAY, plan_json={})
        with self.assertRaises(IntegrityError), transaction.atomic():
            StudyPlan.objects.create(user=self.user, week_start=MONDAY, plan_json={})
        StudyPlan.objects.create(user=self.user, week_start=MONDAY, plan_json={}, is_current=False, revision=2)

    def test_detail_can_include_superseded_revisions(self):
        self.start_week()
        self.put("2026-10-26", [{"name": "A", "difficulty": 4}], more_hours=2, base_revision=1)
        body = self.client.get("/api/planner/plans/2026-10-26/?revisions=1").data
        self.assertEqual(body["revision"], 2)
        self.assertEqual([(r["revision"], r["is_current"], r["revision_count"]) for r in body["revisions"]], [(1, False, 2)])

    def test_plans_are_private(self):
        other = User.objects.create_user(username="other", password="TestPass123!")
        StudyPlan.objects.create(user=other, week_start=MONDAY, plan_json={"marker": "other"})
        self.assertEqual(self.client.get("/api/planner/plans/").data["items"], [])
        self.assertEqual(self.client.get("/api/planner/plans/2026-10-26/").status_code, 404)


class CourseHookTests(WeeklyPlanApiTestCase):
    def test_rename_follows_into_the_current_plan_without_a_new_revision(self):
        self.start_week()
        self.put("2026-10-26", [{"name": "A", "difficulty": 4}, {"name": "B", "difficulty": 3}], more_hours=5, base_revision=1)
        response = self.client.patch(f"/api/planner/courses/{self.a.id}/", {"name": "A2"}, format="json")
        self.assertEqual(response.status_code, 200)
        current = StudyPlan.objects.get(is_current=True)
        self.assertEqual(current.revision, 2)
        self.assertEqual([c["name"] for c in current.plan_json["courses"]], ["A2", "B"])
        self.assertEqual([a["course"] for a in current.plan_json["allocations"]], ["A2", "B"])
        superseded = StudyPlan.objects.get(revision=1)
        self.assertEqual(superseded.plan_json["allocations"][0]["course"], "A")

    def test_rename_follows_into_a_first_version_plan(self):
        self.start_week()
        self.client.patch(f"/api/planner/courses/{self.b.id}/", {"name": "B2"}, format="json")
        plan = StudyPlan.objects.get()
        self.assertEqual([a["course"] for a in plan.plan_json["allocations"]], ["A", "B2"])
        self.assertEqual([c["name"] for c in plan.plan_json["courses"]], ["A", "B2"])

    def test_delete_revises_without_the_course_and_keeps_the_others(self):
        self.start_week()
        self.put("2026-10-26", [{"name": "A", "difficulty": 4}, {"name": "B", "difficulty": 3}], more_hours=5, base_revision=1)
        before = self.by_name(StudyPlan.objects.get(is_current=True).plan_json)["A"]
        self.assertEqual(self.client.delete(f"/api/planner/courses/{self.b.id}/").status_code, 204)
        current = StudyPlan.objects.get(is_current=True)
        self.assertEqual((current.revision, current.plan_json["mode"]), (3, "course_deleted"))
        entries = self.by_name(current.plan_json)
        self.assertEqual(list(entries), ["A"])
        self.assertEqual(entries["A"]["planned_hours"], before["planned_hours"])
        self.assertEqual(current.plan_json["total_hours"], before["planned_hours"])
        self.assertEqual(
            current.plan_json["removed"], [{"course_id": self.b.id, "name": "B", "removed_on": "2026-10-28", "logged_hours": 1.0}]
        )
        self.assertEqual(StudySessionLog.objects.filter(course_name="B").count(), 1)

    def test_delete_from_a_first_version_plan(self):
        self.start_week()
        self.client.delete(f"/api/planner/courses/{self.b.id}/")
        current = StudyPlan.objects.get(is_current=True)
        self.assertEqual(current.revision, 2)
        self.assertEqual({a["course"]: a["allocated_hours"] for a in current.plan_json["allocations"]}, {"A": 7.0})
        self.assertEqual(current.plan_json["total_available_hours"], 7.0)

    def test_delete_a_course_that_is_not_planned_leaves_plans_alone(self):
        self.start_week()
        spare = self.course("Spare")
        self.client.delete(f"/api/planner/courses/{spare.id}/")
        self.assertEqual(StudyPlan.objects.count(), 1)

    def test_delete_also_revises_next_weeks_plan_but_not_last_weeks(self):
        self.start_week()
        StudyPlan.objects.create(
            user=self.user, week_start=MONDAY - timedelta(days=7), plan_json={"allocations": [{"course": "B", "allocated_hours": 2}]}
        )
        self.put("2026-11-02", [{"name": "A", "difficulty": 3}, {"name": "B", "difficulty": 3}], total_hours=6)
        self.client.delete(f"/api/planner/courses/{self.b.id}/")
        self.assertEqual(StudyPlan.objects.filter(week_start=NEXT_MONDAY).count(), 2)
        self.assertEqual(StudyPlan.objects.filter(week_start=MONDAY).count(), 2)
        self.assertEqual(StudyPlan.objects.filter(week_start=MONDAY - timedelta(days=7)).count(), 1)


class CourseSettingsSyncTests(WeeklyPlanApiTestCase):
    """A plan save moves a course's updated_at only when its difficulty changes, not for hours alone."""

    LATER = WEDNESDAY + timedelta(hours=2)

    def save_update(self, courses, **hours):
        with mock.patch("django.utils.timezone.now", return_value=self.LATER):
            response = self.put("2026-10-26", courses, base_revision=1, **hours)
        self.assertEqual(response.status_code, 200, response.data)

    def fresh(self, name):
        return Course.objects.get(user=self.user, name=name)

    def test_a_changed_difficulty_moves_updated_at_for_that_course_only(self):
        self.start_week()
        before = self.fresh("B").weekly_target_hours
        self.save_update([{"name": "A", "difficulty": 5}, {"name": "B", "difficulty": 3}], more_hours=10)
        self.assertEqual((self.fresh("A").difficulty, self.fresh("A").updated_at), (5, self.LATER))
        self.assertEqual(self.fresh("B").updated_at, WEDNESDAY)
        self.assertNotEqual(self.fresh("B").weekly_target_hours, before)  # B's hours still saved

    def test_new_hours_with_the_same_difficulty_leave_updated_at_alone(self):
        self.start_week()
        hours = {n: self.fresh(n).weekly_target_hours for n in ("A", "B")}
        self.save_update([{"name": "A", "difficulty": 4}, {"name": "B", "difficulty": 3}], more_hours=10)
        for name in ("A", "B"):
            self.assertEqual(self.fresh(name).updated_at, WEDNESDAY)
            self.assertNotEqual(self.fresh(name).weekly_target_hours, hours[name])

    def test_a_new_course_is_created_as_before(self):
        self.start_week()
        self.course("C", 2)
        self.save_update([{"name": "A", "difficulty": 4}, {"name": "C", "difficulty": 2}], more_hours=10)
        self.assertEqual(self.fresh("C").updated_at, WEDNESDAY)
        created = self.put("2026-11-02", [{"name": "Brand new", "difficulty": 3}], total_hours=4)
        self.assertEqual(created.status_code, 200, created.data)
        self.assertEqual(self.fresh("Brand new").difficulty, 3)
