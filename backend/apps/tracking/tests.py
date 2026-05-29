from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import StudySessionLog


class TrackingApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser",
            email="testuser@example.com",
            password="TestPass123!",
        )
        self.client.force_authenticate(user=self.user)

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
        response = self.client.post(
            "/api/tracking/predict/",
            {
                "planned_minutes": 120,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("predicted_adherence", response.data)
        self.assertIn("model_version", response.data)
        self.assertIn("inputs", response.data)
        self.assertIn("sessions_last_7_days", response.data["inputs"])
        self.assertIn("consistency_score", response.data["inputs"])

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
