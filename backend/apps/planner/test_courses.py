from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.tracking.models import StudySessionLog

from .models import AssessmentFormat, Course, LearningDemand, StudyPlan

LIST_URL = "/api/planner/courses/"
FIELDS = {
    "id",
    "name",
    "difficulty",
    "learning_demands",
    "builds_on_earlier",
    "assessment_format",
    "exam_date",
    "weekly_target_hours",
    "created_at",
    "updated_at",
}


def detail_url(course_id):
    return f"/api/planner/courses/{course_id}/"


class CourseApiTestCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="coursey", password="TestPass123!")
        self.other = User.objects.create_user(username="othercoursey", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def log(self, user, course_name, minutes=60):
        return StudySessionLog.objects.create(
            user=user, course_name=course_name, planned_minutes=minutes, actual_minutes=minutes, adherence_score=1.0
        )


class CourseCrudTests(CourseApiTestCase):
    def test_create_with_only_a_name_uses_defaults(self):
        response = self.client.post(LIST_URL, {"name": "CSC 401"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(set(response.data), FIELDS)
        self.assertEqual(response.data["name"], "CSC 401")
        self.assertEqual(response.data["difficulty"], 3)
        self.assertEqual(response.data["learning_demands"], [])
        self.assertIsNone(response.data["builds_on_earlier"])
        self.assertEqual(response.data["assessment_format"], "")
        self.assertIsNone(response.data["exam_date"])
        self.assertEqual(response.data["weekly_target_hours"], 3.0)
        self.assertEqual(Course.objects.get().user, self.user)

    def test_create_with_every_trait(self):
        payload = {
            "name": "MTH 401",
            "difficulty": 5,
            "learning_demands": ["problem_solving", "conceptual"],
            "builds_on_earlier": True,
            "assessment_format": "timed_problem_exam",
            "exam_date": "2027-01-20",
        }
        response = self.client.post(LIST_URL, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        for key, value in payload.items():
            self.assertEqual(response.data[key], value)
        course = Course.objects.get()
        self.assertEqual(course.learning_demands, ["problem_solving", "conceptual"])
        self.assertIs(course.builds_on_earlier, True)
        self.assertEqual(str(course.exam_date), "2027-01-20")

    def test_name_is_trimmed(self):
        response = self.client.post(LIST_URL, {"name": "  CSC 401  "}, format="json")
        self.assertEqual(response.data["name"], "CSC 401")

    def test_list_is_ordered_by_name_ignoring_case(self):
        for name in ("mth 401", "CSC 401", "Biology 101", "ENG 401"):
            Course.objects.create(user=self.user, name=name)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([c["name"] for c in response.data], ["Biology 101", "CSC 401", "ENG 401", "mth 401"])
        self.assertEqual(set(response.data[0]), FIELDS)

    def test_list_is_empty_without_courses(self):
        self.assertEqual(self.client.get(LIST_URL).data, [])

    def test_retrieve(self):
        course = Course.objects.create(user=self.user, name="CSC 401", difficulty=4)
        response = self.client.get(detail_url(course.id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], course.id)
        self.assertEqual(response.data["difficulty"], 4)

    def test_patch_updates_only_the_sent_fields(self):
        course = Course.objects.create(
            user=self.user, name="CSC 401", difficulty=4, learning_demands=["writing"], weekly_target_hours=6.5
        )
        response = self.client.patch(
            detail_url(course.id),
            {"difficulty": 2, "builds_on_earlier": False, "assessment_format": "coursework", "exam_date": "2027-02-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        course.refresh_from_db()
        self.assertEqual(course.name, "CSC 401")
        self.assertEqual(course.difficulty, 2)
        self.assertIs(course.builds_on_earlier, False)
        self.assertEqual(course.assessment_format, "coursework")
        self.assertEqual(str(course.exam_date), "2027-02-01")
        self.assertEqual(course.learning_demands, ["writing"])
        self.assertEqual(course.weekly_target_hours, 6.5)

    def test_patch_can_clear_optional_traits(self):
        course = Course.objects.create(
            user=self.user,
            name="CSC 401",
            learning_demands=["writing"],
            builds_on_earlier=True,
            assessment_format="essay_exam",
            exam_date="2027-02-01",
        )
        response = self.client.patch(
            detail_url(course.id),
            {"learning_demands": [], "builds_on_earlier": None, "assessment_format": "", "exam_date": None},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        course.refresh_from_db()
        self.assertEqual(course.learning_demands, [])
        self.assertIsNone(course.builds_on_earlier)
        self.assertEqual(course.assessment_format, "")
        self.assertIsNone(course.exam_date)

    def test_read_only_fields_cannot_be_set(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        self.client.patch(detail_url(course.id), {"weekly_target_hours": 99, "id": 12345}, format="json")
        course.refresh_from_db()
        self.assertEqual(course.weekly_target_hours, 3.0)
        self.assertNotEqual(course.id, 12345)

    def test_put_is_not_allowed(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        self.assertEqual(self.client.put(detail_url(course.id), {"name": "X"}, format="json").status_code, 405)

    def test_delete(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        response = self.client.delete(detail_url(course.id))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Course.objects.filter(id=course.id).exists())

    def test_endpoints_require_authentication(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)
        self.assertEqual(self.client.post(LIST_URL, {"name": "X"}, format="json").status_code, 401)
        self.assertEqual(self.client.get(detail_url(course.id)).status_code, 401)
        self.assertEqual(self.client.patch(detail_url(course.id), {}, format="json").status_code, 401)
        self.assertEqual(self.client.delete(detail_url(course.id)).status_code, 401)

    def test_unknown_id_is_404(self):
        self.assertEqual(self.client.get(detail_url(999999)).status_code, 404)


class CourseIsolationTests(CourseApiTestCase):
    def setUp(self):
        super().setUp()
        self.theirs = Course.objects.create(user=self.other, name="Theirs 101", difficulty=5)
        self.mine = Course.objects.create(user=self.user, name="Mine 101")

    def test_another_users_course_is_absent_from_the_list(self):
        response = self.client.get(LIST_URL)
        self.assertEqual([c["name"] for c in response.data], ["Mine 101"])

    def test_get_patch_and_delete_another_users_course_are_404(self):
        url = detail_url(self.theirs.id)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"difficulty": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.difficulty, 5)

    def test_two_users_can_have_the_same_course_name(self):
        response = self.client.post(LIST_URL, {"name": "Theirs 101"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Course.objects.filter(name="Theirs 101").count(), 2)


class CourseValidationTests(CourseApiTestCase):
    def post(self, **overrides):
        data = {"name": "CSC 401"}
        data.update(overrides)
        return self.client.post(LIST_URL, data, format="json")

    def assert_rejected(self, response, field):
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn(field, response.data)
        self.assertEqual(Course.objects.count(), 0)

    def test_duplicate_name_in_any_casing_is_rejected_and_named(self):
        Course.objects.create(user=self.user, name="CSC 401")
        for name in ("CSC 401", "csc 401", "Csc 401", "  csc 401  "):
            with self.subTest(name=name):
                response = self.post(name=name)
                self.assertEqual(response.status_code, 400)
                self.assertIn('"CSC 401"', str(response.data["name"]))
        self.assertEqual(Course.objects.count(), 1)

    def test_blank_or_missing_name_is_rejected(self):
        for name in ("", "   "):
            with self.subTest(name=name):
                self.assert_rejected(self.post(name=name), "name")
        self.assert_rejected(self.client.post(LIST_URL, {}, format="json"), "name")

    def test_name_longer_than_120_characters_is_rejected(self):
        self.assert_rejected(self.post(name="x" * 121), "name")
        self.assertEqual(self.post(name="x" * 120).status_code, 201)

    def test_difficulty_must_be_1_to_5(self):
        for difficulty in (0, 6, -1, "abc", 2.5):
            with self.subTest(difficulty=difficulty):
                self.assert_rejected(self.post(difficulty=difficulty), "difficulty")
        for difficulty in (1, 5):
            Course.objects.all().delete()
            self.assertEqual(self.post(difficulty=difficulty).status_code, 201)

    def test_unknown_learning_demand_is_rejected(self):
        self.assert_rejected(self.post(learning_demands=["telepathy"]), "learning_demands")

    def test_more_than_three_learning_demands_is_rejected(self):
        demands = [choice.value for choice in LearningDemand][:4]
        self.assert_rejected(self.post(learning_demands=demands), "learning_demands")

    def test_three_learning_demands_are_accepted(self):
        demands = [choice.value for choice in LearningDemand][:3]
        self.assertEqual(self.post(learning_demands=demands).status_code, 201)

    def test_duplicated_learning_demand_is_rejected(self):
        self.assert_rejected(self.post(learning_demands=["writing", "writing"]), "learning_demands")

    def test_learning_demands_must_be_a_list(self):
        self.assert_rejected(self.post(learning_demands="writing"), "learning_demands")

    def test_every_listed_demand_and_format_is_accepted(self):
        for demand in LearningDemand:
            Course.objects.all().delete()
            self.assertEqual(self.post(learning_demands=[demand.value]).status_code, 201, demand)
        for fmt in AssessmentFormat:
            Course.objects.all().delete()
            self.assertEqual(self.post(assessment_format=fmt.value).status_code, 201, fmt)

    def test_unknown_assessment_format_is_rejected(self):
        self.assert_rejected(self.post(assessment_format="oral_exam"), "assessment_format")

    def test_invalid_exam_date_is_rejected(self):
        for value in ("not a date", "2027-13-40", "20/01/2027", 5):
            with self.subTest(value=value):
                self.assert_rejected(self.post(exam_date=value), "exam_date")

    def test_builds_on_earlier_must_be_a_boolean_or_null(self):
        self.assert_rejected(self.post(builds_on_earlier="maybe"), "builds_on_earlier")
        self.assertEqual(self.post(builds_on_earlier=None).status_code, 201)

    def test_patch_applies_the_same_rules(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        for payload in (
            {"difficulty": 0},
            {"difficulty": 6},
            {"learning_demands": ["telepathy"]},
            {"learning_demands": ["writing", "writing"]},
            {"assessment_format": "oral_exam"},
            {"exam_date": "nope"},
            {"name": "  "},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.patch(detail_url(course.id), payload, format="json").status_code, 400)


class CourseRenameTests(CourseApiTestCase):
    def test_rename_moves_the_users_logs_and_leaves_others_alone(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        Course.objects.create(user=self.other, name="CSC 401")
        mine = [self.log(self.user, "CSC 401"), self.log(self.user, "csc 401"), self.log(self.user, "Csc 401")]
        unrelated = self.log(self.user, "MTH 401")
        theirs = self.log(self.other, "CSC 401")

        response = self.client.patch(detail_url(course.id), {"name": "CSC 402 Algorithms"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["name"], "CSC 402 Algorithms")

        for log in mine:
            log.refresh_from_db()
            self.assertEqual(log.course_name, "CSC 402 Algorithms")
        unrelated.refresh_from_db()
        theirs.refresh_from_db()
        self.assertEqual(unrelated.course_name, "MTH 401")
        self.assertEqual(theirs.course_name, "CSC 401")

    def test_rename_that_only_changes_casing_canonicalises_the_logs(self):
        course = Course.objects.create(user=self.user, name="csc 401")
        log = self.log(self.user, "CSC 401")
        response = self.client.patch(detail_url(course.id), {"name": "CSC 401"}, format="json")
        self.assertEqual(response.status_code, 200)
        log.refresh_from_db()
        self.assertEqual(log.course_name, "CSC 401")

    def test_patching_other_fields_leaves_logs_alone(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        log = self.log(self.user, "csc 401")
        self.client.patch(detail_url(course.id), {"difficulty": 5}, format="json")
        log.refresh_from_db()
        self.assertEqual(log.course_name, "csc 401")

    def test_rename_collision_is_rejected_and_changes_nothing(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        Course.objects.create(user=self.user, name="MTH 401")
        log = self.log(self.user, "CSC 401")
        for name in ("MTH 401", "mth 401", " Mth 401 "):
            with self.subTest(name=name):
                response = self.client.patch(detail_url(course.id), {"name": name}, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn('"MTH 401"', str(response.data["name"]))
        course.refresh_from_db()
        log.refresh_from_db()
        self.assertEqual(course.name, "CSC 401")
        self.assertEqual(log.course_name, "CSC 401")

    def test_renaming_to_a_name_another_user_has_is_allowed(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        Course.objects.create(user=self.other, name="PHY 301")
        response = self.client.patch(detail_url(course.id), {"name": "PHY 301"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_rename_keeps_forecast_history_attached(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        for days_ago in (20, 13, 6):
            log = self.log(self.user, "CSC 401")
            StudySessionLog.objects.filter(pk=log.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
        self.client.patch(detail_url(course.id), {"name": "CSC 402"}, format="json")
        response = self.client.post("/api/tracking/predict/", {"course_name": "CSC 402"}, format="json")
        self.assertEqual(response.data[0]["weeks_history"], 2)


class CourseDeleteTests(CourseApiTestCase):
    def test_delete_keeps_session_logs_and_plan_history(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        self.log(self.user, "CSC 401")
        plan = StudyPlan.objects.create(
            user=self.user, week_start=timezone.localdate(), plan_json={"allocations": [{"course": "CSC 401"}]}
        )
        self.assertEqual(self.client.delete(detail_url(course.id)).status_code, 204)
        self.assertEqual(StudySessionLog.objects.filter(user=self.user, course_name="CSC 401").count(), 1)
        plan.refresh_from_db()
        self.assertEqual(plan.plan_json["allocations"][0]["course"], "CSC 401")

    def test_a_deleted_course_can_be_added_again(self):
        course = Course.objects.create(user=self.user, name="CSC 401")
        self.client.delete(detail_url(course.id))
        self.assertEqual(self.client.post(LIST_URL, {"name": "csc 401"}, format="json").status_code, 201)


class PlannerUsesStoredNamesTests(CourseApiTestCase):
    def generate(self, *names):
        response = self.client.post(
            "/api/planner/generate/",
            {"total_available_hours": 10, "courses": [{"name": n, "difficulty": 3} for n in names]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_allocations_and_plan_history_use_the_stored_name(self):
        Course.objects.create(user=self.user, name="CSC 401 Algorithms")
        response = self.generate("  csc 401 algorithms ", "New course")
        self.assertEqual([a["course"] for a in response.data["allocations"]], ["CSC 401 Algorithms", "New course"])
        plan = StudyPlan.objects.get()
        self.assertEqual([c["name"] for c in plan.plan_json["courses"]], ["CSC 401 Algorithms", "New course"])
        self.assertEqual([a["course"] for a in plan.plan_json["allocations"]], ["CSC 401 Algorithms", "New course"])
        self.assertEqual(Course.objects.filter(user=self.user).count(), 2)

    def test_generate_still_creates_missing_courses(self):
        self.generate("Fresh course")
        course = Course.objects.get(user=self.user)
        self.assertEqual(course.name, "Fresh course")
        self.assertEqual(course.learning_demands, [])

    def test_generate_keeps_the_traits_of_an_existing_course(self):
        Course.objects.create(
            user=self.user, name="MTH 401", learning_demands=["problem_solving"], assessment_format="coursework"
        )
        self.generate("mth 401")
        course = Course.objects.get()
        self.assertEqual(course.name, "MTH 401")
        self.assertEqual(course.learning_demands, ["problem_solving"])
        self.assertEqual(course.assessment_format, "coursework")

    def test_a_plan_for_another_users_course_name_does_not_touch_it(self):
        theirs = Course.objects.create(user=self.other, name="CSC 401", difficulty=5)
        self.generate("csc 401")
        theirs.refresh_from_db()
        self.assertEqual(theirs.name, "CSC 401")
        self.assertEqual(theirs.difficulty, 5)
        self.assertEqual(Course.objects.get(user=self.user).name, "csc 401")
