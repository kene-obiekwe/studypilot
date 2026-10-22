import importlib

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.utils import IntegrityError
from django.test import TransactionTestCase

BEFORE = [("planner", "0001_initial")]
AFTER = [("planner", "0002_unique_course_per_user")]

migration_module = importlib.import_module("apps.planner.migrations.0002_unique_course_per_user")


class CourseUniquenessMigrationTests(TransactionTestCase):
    """Roll planner back to 0001, build duplicate rows with the historical model, then migrate forward."""

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        self.old_apps = executor.loader.project_state(BEFORE).apps
        self.User = self.old_apps.get_model("auth", "User")
        self.Course = self.old_apps.get_model("planner", "Course")
        self.alice = self.User.objects.create(username="alice")
        self.bob = self.User.objects.create(username="bob")

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def make(self, user, name, difficulty=3):
        return self.Course.objects.create(user=user, name=name, difficulty=difficulty, weekly_target_hours=1.0)

    def test_dedupe_keeps_the_highest_id_per_user_and_name(self):
        older = self.make(self.alice, "CSC 401", difficulty=1)
        middle = self.make(self.alice, "CSC 401", difficulty=2)
        newest = self.make(self.alice, "CSC 401", difficulty=4)
        bob_csc = self.make(self.bob, "CSC 401")
        alice_mth = self.make(self.alice, "MTH 401")
        self.make(self.bob, "PHY 301")
        bob_phy = self.make(self.bob, "PHY 301")

        migration_module.remove_duplicate_courses(self.old_apps, None)

        kept = set(self.Course.objects.values_list("id", flat=True))
        self.assertEqual(kept, {newest.id, bob_csc.id, alice_mth.id, bob_phy.id})
        self.assertNotIn(older.id, kept)
        self.assertNotIn(middle.id, kept)
        self.assertEqual(self.Course.objects.get(id=newest.id).difficulty, 4)

    def test_dedupe_is_case_sensitive_like_the_constraint(self):
        self.make(self.alice, "CSC 401")
        self.make(self.alice, "csc 401")
        migration_module.remove_duplicate_courses(self.old_apps, None)
        self.assertEqual(self.Course.objects.count(), 2)

    def test_dedupe_leaves_unique_data_alone(self):
        self.make(self.alice, "A")
        self.make(self.alice, "B")
        self.make(self.bob, "A")
        migration_module.remove_duplicate_courses(self.old_apps, None)
        self.assertEqual(self.Course.objects.count(), 3)

    def test_migrating_forward_removes_duplicates_and_adds_the_constraint(self):
        self.make(self.alice, "CSC 401", difficulty=1)
        newest = self.make(self.alice, "CSC 401", difficulty=2)
        self.make(self.bob, "CSC 401")

        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        Course = executor.loader.project_state(AFTER).apps.get_model("planner", "Course")

        self.assertEqual(Course.objects.count(), 2)
        self.assertEqual(Course.objects.get(user_id=self.alice.id, name="CSC 401").id, newest.id)
        with self.assertRaises(IntegrityError):
            Course.objects.create(user_id=self.alice.id, name="CSC 401")

    def test_migrating_backward_drops_the_constraint(self):
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        self.make(self.alice, "dup")
        self.make(self.alice, "dup")
        self.assertEqual(self.Course.objects.filter(name="dup").count(), 2)
