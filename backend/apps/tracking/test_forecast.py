import json
import tempfile
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
from django.conf import settings
from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from . import inference
from .inference import LoadedModel, SessionPoint
from .models import StudySessionLog

WEEK0 = date(2026, 1, 5)


def point(day_offset, planned, actual, focus):
    return SessionPoint(WEEK0 + timedelta(days=day_offset), planned, actual, focus)


# Week 0: two days, 120 planned / 90 actual -> 0.75, focus mean 0.7
# Week 1: no logs -> gap-filled zeros
# Week 2: one day, actual > planned -> 1.0
# Week 3: three logs on one day, 180 planned / 90 actual -> 0.5, focus 0.4
# Week 4: the current week -> must be ignored
HISTORY = [
    point(0, 60, 60, 0.8),
    point(3, 60, 30, 0.6),
    point(15, 60, 90, 0.9),
    point(22, 60, 30, 0.3),
    point(22, 60, 30, 0.4),
    point(22, 60, 30, 0.5),
]
TODAY = WEEK0 + timedelta(days=30)  # week 4
CURRENT_WEEK = [point(28, 60, 0, 0.1), point(29, 60, 5, 0.2)]


class FakePipeline:
    def __init__(self, value):
        self.value = value
        self.frames = []

    def predict(self, frame):
        self.frames.append(frame)
        return np.array([self.value])


def fake_model(value=0.4, feature_order=None):
    return LoadedModel(
        pipeline=FakePipeline(value),
        feature_order=list(feature_order or reversed(inference.SUPPORTED_FEATURES)),
        version="fake_forecast@20260101T000000",
        min_weeks_history=2,
    )


class WeeklyFeatureBuilderTests(SimpleTestCase):
    def test_weekly_summaries_gap_fill_and_clip(self):
        weeks = inference.weekly_summaries(HISTORY, TODAY)
        self.assertEqual(len(weeks), 4)
        self.assertEqual([w.adherence for w in weeks], [0.75, 0.0, 1.0, 0.5])
        self.assertEqual([w.active_days for w in weeks], [2, 0, 1, 1])
        self.assertAlmostEqual(weeks[0].focus, 0.7)
        self.assertEqual(weeks[1].focus, 0.0)
        self.assertAlmostEqual(weeks[3].focus, 0.4)

    def test_features_use_lags_of_complete_weeks(self):
        features = inference.forecast_features(inference.weekly_summaries(HISTORY, TODAY))
        expected = {
            "adh_lag1": 0.5,
            "adh_lag2": 1.0,
            "adh_mean3": (0.0 + 1.0 + 0.5) / 3,
            "adh_trend": -0.5,
            "active_days_lag1": 1.0,
            "active_days_mean3": (0 + 1 + 1) / 3,
            "focus_lag1": 0.4,
            "weeks_history": 4.0,
        }
        for name, value in expected.items():
            self.assertAlmostEqual(features[name], value, msg=name)

    def test_current_week_is_excluded(self):
        without = inference.forecast_features(inference.weekly_summaries(HISTORY, TODAY))
        with_current = inference.forecast_features(inference.weekly_summaries(HISTORY + CURRENT_WEEK, TODAY))
        self.assertEqual(without, with_current)

    def test_short_history_has_missing_lags(self):
        features = inference.forecast_features(inference.weekly_summaries(HISTORY[:2], WEEK0 + timedelta(days=8)))
        self.assertEqual(features["weeks_history"], 1.0)
        self.assertEqual(features["adh_lag1"], 0.75)
        self.assertIsNone(features["adh_lag2"])
        self.assertIsNone(features["adh_trend"])
        self.assertEqual(features["adh_mean3"], 0.75)

    def test_insufficient_history_skips_the_model(self):
        model = fake_model()
        with mock.patch.object(inference, "get_model", return_value=model):
            result = inference.forecast_from_points(HISTORY[:2], WEEK0 + timedelta(days=8))
        self.assertEqual(result.status, inference.STATUS_INSUFFICIENT_HISTORY)
        self.assertIsNone(result.predicted_adherence)
        self.assertEqual(result.weeks_history, 1)
        self.assertEqual(model.pipeline.frames, [])

    def test_prediction_uses_meta_feature_order_and_is_clipped(self):
        model = fake_model(value=1.3)
        with mock.patch.object(inference, "get_model", return_value=model):
            result = inference.forecast_from_points(HISTORY, TODAY)
        self.assertEqual(result.status, inference.STATUS_OK)
        self.assertEqual(result.predicted_adherence, 1.0)
        self.assertEqual(result.model_version, "fake_forecast@20260101T000000")
        frame = model.pipeline.frames[0]
        self.assertEqual(list(frame.columns), model.feature_order)
        self.assertEqual(frame.iloc[0]["adh_lag1"], 0.5)

    def test_missing_lags_reach_the_model_as_nan(self):
        # A week whose planned minutes sum to 0 has undefined adherence (like expected_clicks == 0).
        points = [point(0, 60, 60, 0.5), point(8, 0, 0, 0.5)]
        model = fake_model()
        with mock.patch.object(inference, "get_model", return_value=model):
            result = inference.forecast_from_points(points, WEEK0 + timedelta(days=15))
        self.assertEqual(result.status, inference.STATUS_OK)
        row = model.pipeline.frames[0].iloc[0]
        self.assertTrue(np.isnan(row["adh_lag1"]))
        self.assertTrue(np.isnan(row["adh_trend"]))
        self.assertEqual(row["adh_lag2"], 1.0)
        self.assertEqual(row["adh_mean3"], 1.0)
        self.assertEqual(row["active_days_lag1"], 1.0)

    @override_settings(TIME_ZONE="Africa/Lagos")
    def test_log_dates_use_settings_time_zone(self):
        # 23:30 UTC on Sunday is 00:30 Monday in Lagos (UTC+1).
        log = SimpleNamespace(
            created_at=datetime(2026, 1, 4, 23, 30, tzinfo=dt_timezone.utc),
            planned_minutes=60,
            actual_minutes=60,
            focus_score=0.5,
        )
        self.assertEqual(inference.session_points([log])[0].day, date(2026, 1, 5))

    @mock.patch.object(inference, "get_model", return_value=None)
    def test_unavailable_model_reports_status(self, _):
        result = inference.forecast_from_points(HISTORY, TODAY)
        self.assertEqual(result.status, inference.STATUS_MODEL_UNAVAILABLE)
        self.assertIsNone(result.predicted_adherence)


class ModelLoadingTests(SimpleTestCase):
    def tearDown(self):
        inference.get_model.cache_clear()

    def test_feature_names_match_the_meta_file(self):
        meta_path = Path(settings.ADHERENCE_MODEL_PATH).with_suffix(".meta.json")
        if not meta_path.exists():
            self.skipTest(f"model meta file not present: {meta_path}")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        features = inference.forecast_features(inference.weekly_summaries(HISTORY, TODAY))
        self.assertEqual(list(features), meta["feature_order"])

    def test_sklearn_version_mismatch_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            model_path = Path(tmp) / "forecast.joblib"
            model_path.write_bytes(b"not a model")
            model_path.with_suffix(".meta.json").write_text(
                json.dumps({"sklearn_version": "0.9.0", "feature_order": list(inference.SUPPORTED_FEATURES)})
            )
            inference.get_model.cache_clear()
            with override_settings(ADHERENCE_MODEL_PATH=model_path), self.assertLogs(inference.logger, "WARNING"):
                self.assertIsNone(inference.get_model())

    def test_missing_or_unreadable_files_are_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            model_path = Path(tmp) / "forecast.joblib"
            inference.get_model.cache_clear()
            with override_settings(ADHERENCE_MODEL_PATH=model_path), self.assertLogs(inference.logger, "WARNING"):
                self.assertIsNone(inference.get_model())

            import sklearn

            model_path.write_bytes(b"not a model")
            model_path.with_suffix(".meta.json").write_text(
                json.dumps({"sklearn_version": sklearn.__version__, "feature_order": list(inference.SUPPORTED_FEATURES)})
            )
            inference.get_model.cache_clear()
            with override_settings(ADHERENCE_MODEL_PATH=model_path), self.assertLogs(inference.logger, "WARNING"):
                self.assertIsNone(inference.get_model())


class TrackingForecastApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="forecaster", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def test_predict_without_course_covers_all_logged_courses(self):
        for name in ("MTH 401", "CSC 401", "CSC 401"):
            StudySessionLog.objects.create(
                user=self.user, course_name=name, planned_minutes=60, actual_minutes=60, focus_score=0.5
            )
        response = self.client.post("/api/tracking/predict/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["course_name"] for item in response.data], ["CSC 401", "MTH 401"])

    def test_session_log_caps_adherence_and_stores_status(self):
        response = self.client.post(
            "/api/tracking/session-log/",
            {
                "course_name": "CSC 401",
                "planned_minutes": 60,
                "actual_minutes": 150,
                "focus_score": 0.6,
                "completion_rate": 0.7,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        log = StudySessionLog.objects.get()
        self.assertEqual(log.adherence_score, 1.0)
        self.assertIsNone(log.predicted_adherence)
        self.assertEqual(log.model_version, inference.STATUS_INSUFFICIENT_HISTORY)
