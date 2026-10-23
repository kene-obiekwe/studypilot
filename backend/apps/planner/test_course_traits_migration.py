from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("planner", "0002_unique_course_per_user")]
AFTER = [("planner", "0003_course_learning_traits")]


class CourseTraitsMigrationTests(TransactionTestCase):
    """Rows created before 0003 migrate with the documented defaults."""

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        old_apps = executor.loader.project_state(BEFORE).apps
        user = old_apps.get_model("auth", "User").objects.create(username="olduser")
        self.course_id = old_apps.get_model("planner", "Course").objects.create(
            user=user, name="CSC 401", difficulty=4, weekly_target_hours=6.0
        ).id

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_rows_get_the_defaults(self):
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        Course = executor.loader.project_state(AFTER).apps.get_model("planner", "Course")
        course = Course.objects.get(id=self.course_id)
        self.assertEqual(course.name, "CSC 401")
        self.assertEqual(course.difficulty, 4)
        self.assertEqual(course.weekly_target_hours, 6.0)
        self.assertEqual(course.learning_demands, [])
        self.assertIsNone(course.builds_on_earlier)
        self.assertEqual(course.assessment_format, "")
        self.assertIsNone(course.exam_date)
        self.assertIsNotNone(course.created_at)
        self.assertIsNotNone(course.updated_at)

    def test_unique_constraint_survives(self):
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        Course = executor.loader.project_state(AFTER).apps.get_model("planner", "Course")
        user_id = Course.objects.get(id=self.course_id).user_id
        from django.db.utils import IntegrityError

        with self.assertRaises(IntegrityError):
            Course.objects.create(user_id=user_id, name="CSC 401")
