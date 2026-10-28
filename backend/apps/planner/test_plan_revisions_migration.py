from datetime import date, datetime, timedelta, timezone as dt_timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("planner", "0003_course_learning_traits")]
AFTER = [("planner", "0004_plan_revisions")]
MONDAY = date(2026, 10, 19)
T0 = datetime(2026, 10, 19, 9, 0, tzinfo=dt_timezone.utc)


def migrate(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(target)
    return executor.loader.project_state(target).apps


class PlanRevisionsMigrationTests(TransactionTestCase):
    """Several plans in one week (the old behaviour) become revisions: the newest current, nothing deleted."""

    def setUp(self):
        old_apps = migrate(BEFORE)
        User = old_apps.get_model("auth", "User")
        StudyPlan = old_apps.get_model("planner", "StudyPlan")
        alice, bob = User.objects.create(username="alice"), User.objects.create(username="bob")

        def plan(user, week, marker, hours_after):
            row = StudyPlan.objects.create(user=user, week_start=week, plan_json={"marker": marker})
            StudyPlan.objects.filter(pk=row.pk).update(created_at=T0 + timedelta(hours=hours_after))
            return row.pk

        # Created out of order: revisions follow created_at, not id.
        self.ids = {
            "a-second": plan(alice, MONDAY, "a-second", 2),
            "a-first": plan(alice, MONDAY, "a-first", 1),
            "a-third": plan(alice, MONDAY, "a-third", 3),
            "a-last-week": plan(alice, MONDAY - timedelta(days=7), "a-last-week", -100),
            "b-only": plan(bob, MONDAY, "b-only", 5),
        }

    def tearDown(self):
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())

    def test_forwards_marks_revisions_and_backwards_keeps_rows(self):
        new_apps = migrate(AFTER)
        StudyPlan = new_apps.get_model("planner", "StudyPlan")
        rows = {
            p.plan_json["marker"]: (p.revision, p.is_current, p.superseded_at)
            for p in StudyPlan.objects.all()
        }
        self.assertEqual(
            rows,
            {
                "a-first": (1, False, T0 + timedelta(hours=2)),
                "a-second": (2, False, T0 + timedelta(hours=3)),
                "a-third": (3, True, None),
                "a-last-week": (1, True, None),
                "b-only": (1, True, None),
            },
        )

        old_apps = migrate(BEFORE)
        StudyPlan = old_apps.get_model("planner", "StudyPlan")
        self.assertEqual(set(StudyPlan.objects.values_list("id", flat=True)), set(self.ids.values()))
