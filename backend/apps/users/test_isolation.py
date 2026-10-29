from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from apps.planner.plan_testing import first_plan


class CrossUserIsolationTests(APITestCase):
    """User A must never see user B's plans, recommendations, sessions or forecasts."""

    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="TestPass123!")
        self.bob = User.objects.create_user(username="bob", password="TestPass123!")

        self.client.force_authenticate(user=self.alice)
        self.create_data("ALICE 101", focus=0.2)
        self.client.force_authenticate(user=self.bob)
        self.create_data("BOB 202", focus=0.9)

    def create_data(self, course_name, focus):
        plan = first_plan(self.client, [{"name": course_name, "difficulty": 3}], 10)
        self.assertEqual(plan.status_code, 200, plan.data)
        session = self.client.post(
            "/api/tracking/session-log/",
            {
                "course_name": course_name,
                "planned_minutes": 60,
                "actual_minutes": 30,
                "focus_score": focus,
                "completion_rate": 0.8,
            },
            format="json",
        )
        self.assertEqual(session.status_code, 200, session.data)

    def get_as(self, user, url):
        self.client.force_authenticate(user=user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_plan_history_is_private(self):
        for user, own, foreign in [(self.alice, "ALICE 101", "BOB 202"), (self.bob, "BOB 202", "ALICE 101")]:
            with self.subTest(user=user.username):
                items = self.get_as(user, "/api/planner/plans/")["items"]
                self.assertEqual(len(items), 1)
                courses = [a["course"] for a in items[0]["plan_json"]["allocations"]]
                self.assertEqual(courses, [own])
                self.assertNotIn(foreign, str(items))

    def test_session_history_is_private(self):
        alice_items = self.get_as(self.alice, "/api/tracking/history/")["items"]
        bob_items = self.get_as(self.bob, "/api/tracking/history/")["items"]
        self.assertEqual([i["course_name"] for i in alice_items], ["ALICE 101"])
        self.assertEqual([i["course_name"] for i in bob_items], ["BOB 202"])

    def test_training_data_is_private(self):
        alice_data = self.get_as(self.alice, "/api/tracking/training-data/")
        bob_data = self.get_as(self.bob, "/api/tracking/training-data/")
        self.assertEqual([r["course_name"] for r in alice_data["rows"]], ["ALICE 101"])
        self.assertEqual({r["user_id"] for r in alice_data["rows"]}, {self.alice.id})
        self.assertEqual([r["course_name"] for r in bob_data["rows"]], ["BOB 202"])
        self.assertEqual({r["user_id"] for r in bob_data["rows"]}, {self.bob.id})

    def test_forecast_lists_only_own_courses(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.post("/api/tracking/predict/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([f["course_name"] for f in response.data], ["ALICE 101"])
