from datetime import timedelta
from unittest import mock

import numpy as np
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.tracking import inference
from apps.tracking.models import StudySessionLog

from .models import StudyPlan
from .plan_testing import allocations, first_plan


class FakePipeline:
    def predict(self, frame):
        return np.array([0.4])


FAKE_MODEL = inference.LoadedModel(
    pipeline=FakePipeline(),
    feature_order=list(inference.SUPPORTED_FEATURES),
    version="fake_forecast@20260101T000000",
    min_weeks_history=2,
)


class PlannerAdjustmentSourceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="planner", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def log(self, course_name, days_ago, planned, actual):
        log = StudySessionLog.objects.create(
            user=self.user,
            course_name=course_name,
            planned_minutes=planned,
            actual_minutes=actual,
            focus_score=0.6,
            adherence_score=min(actual / planned, 1.0),
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=timezone.now() - timedelta(days=days_ago))

    def plan(self, *course_names):
        response = first_plan(self.client, [{"name": n, "difficulty": 3} for n in course_names], 10)
        self.assertEqual(response.status_code, 200, response.data)
        return {item["course"]: item for item in allocations(response)}

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_model_source_when_forecast_available(self, _):
        for days_ago in (20, 13, 6):  # three complete weeks before the current one
            self.log("CSC 401", days_ago, 60, 60)
        allocation = self.plan("CSC 401", "MTH 401")["CSC 401"]
        self.assertEqual(allocation["adjustment_source"], "model")
        self.assertEqual(allocation["adherence_estimate"], 0.4)
        self.assertEqual(allocation["adherence_factor"], 0.8)

        stored = StudyPlan.objects.get().plan_json["allocations"]
        self.assertEqual({a["course"]: a["adjustment_source"] for a in stored}, {"CSC 401": "model", "MTH 401": "none"})

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_rule_source_when_history_is_too_short(self, _):
        self.log("CSC 401", 1, 100, 50)
        self.log("CSC 401", 0, 100, 70)
        allocation = self.plan("CSC 401")["CSC 401"]
        self.assertEqual(allocation["adjustment_source"], "rule")
        self.assertAlmostEqual(allocation["adherence_estimate"], 0.6)
        self.assertEqual(allocation["adherence_factor"], 0.9)

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_rule_clamps_legacy_adherence_above_one(self, _):
        self.log("CSC 401", 1, 100, 50)
        legacy = StudySessionLog.objects.create(
            user=self.user, course_name="CSC 401", planned_minutes=100, actual_minutes=250, adherence_score=2.5
        )
        StudySessionLog.objects.filter(pk=legacy.pk).update(created_at=timezone.now() - timedelta(days=1))
        allocation = self.plan("CSC 401")["CSC 401"]
        self.assertEqual(allocation["adjustment_source"], "rule")
        self.assertAlmostEqual(allocation["adherence_estimate"], 0.75)  # unclamped mean would be 1.5
        self.assertEqual(allocation["adherence_factor"], 1.0)

    @mock.patch.object(inference, "get_model", return_value=FAKE_MODEL)
    def test_none_source_without_logs(self, _):
        allocation = self.plan("PHY 301")["PHY 301"]
        self.assertEqual(allocation["adjustment_source"], "none")
        self.assertIsNone(allocation["adherence_estimate"])
        self.assertEqual(allocation["allocated_hours"], 10.0)
