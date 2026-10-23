from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from apps.planner.models import Course

from .models import StudySessionLog


class TrackingApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser",
            email="testuser@example.com",
            password="TestPass123!",
        )
        self.client.force_authenticate(user=self.user)
        Course.objects.create(user=self.user, name="CSC 401")

    def test_predict_requires_auth(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            "/api/tracking/predict/",
            {
                "planned_minutes": 120,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_predict_returns_forecast(self):
        # Old slider fields are ignored rather than rejected.
        response = self.client.post(
            "/api/tracking/predict/",
            {
                "course_name": "CSC 401",
                "planned_minutes": 120,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        forecast = response.data[0]
        for key in ("course_name", "status", "predicted_adherence", "weeks_history", "features"):
            self.assertIn(key, forecast)
        self.assertEqual(forecast["course_name"], "CSC 401")
        self.assertEqual(forecast["status"], "insufficient_history")
        self.assertIsNone(forecast["predicted_adherence"])

    def test_session_log_requires_auth(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            "/api/tracking/session-log/",
            {
                "course_name": "CSC 401",
                "planned_minutes": 120,
                "actual_minutes": 90,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_session_log_creates_record(self):
        response = self.client.post(
            "/api/tracking/session-log/",
            {
                "course_name": "CSC 401",
                "planned_minutes": 120,
                "actual_minutes": 90,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(StudySessionLog.objects.count(), 1)
        log = StudySessionLog.objects.first()
        assert log is not None
        self.assertEqual(log.course_name, "CSC 401")
        self.assertIn("computed", response.data)
        self.assertIn("predicted_adherence", response.data["computed"])
        self.assertIn("model_version", response.data["computed"])
