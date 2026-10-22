"""Next-week adherence forecast for a user's course.

The model (backend/ml/train_oulad_models.py) forecasts week t's adherence from
complete weeks < t only. This module rebuilds the same weekly history from the
app's StudySessionLog rows, computes the features the model was trained on, and
never raises to the caller: every outcome is a ForecastResult with a status.
"""

from __future__ import annotations

import json
import logging
import warnings
from dataclasses import asdict, dataclass
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from statistics import mean
from typing import Any, Iterable

import joblib
import numpy as np
import pandas as pd
import sklearn
from django.conf import settings
from django.utils import timezone
from sklearn.exceptions import InconsistentVersionWarning

logger = logging.getLogger(__name__)

STATUS_OK = "ok"
STATUS_INSUFFICIENT_HISTORY = "insufficient_history"
STATUS_MODEL_UNAVAILABLE = "model_unavailable"
STATUS_PREDICTION_FAILED = "prediction_failed"

WEEK_DAYS = 7
DEFAULT_MIN_WEEKS_HISTORY = 2
MODEL_VERSION_MAX_LENGTH = 50  # StudySessionLog.model_version

# Features this module can compute. The model's column order comes from its meta file.
SUPPORTED_FEATURES = (
    "adh_lag1",
    "adh_lag2",
    "adh_mean3",
    "adh_trend",
    "active_days_lag1",
    "active_days_mean3",
    "focus_lag1",
    "weeks_history",
)


@dataclass(frozen=True)
class SessionPoint:
    day: date
    planned_minutes: int
    actual_minutes: int
    focus_score: float


@dataclass(frozen=True)
class WeekSummary:
    adherence: float | None
    active_days: int
    focus: float


@dataclass(frozen=True)
class LoadedModel:
    pipeline: Any
    feature_order: list[str]
    version: str
    min_weeks_history: int


@dataclass(frozen=True)
class ForecastResult:
    status: str
    predicted_adherence: float | None
    model_version: str | None
    weeks_history: int
    features: dict[str, float | None]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# -- weekly history and features (no model, no ORM) ----------------------------


def session_points(logs: Iterable[Any]) -> list[SessionPoint]:
    """Convert StudySessionLog-like objects to dated points in settings.TIME_ZONE."""
    tz = timezone.get_default_timezone()
    return [
        SessionPoint(
            day=timezone.localtime(log.created_at, tz).date(),
            planned_minutes=int(log.planned_minutes),
            actual_minutes=int(log.actual_minutes),
            focus_score=float(log.focus_score),
        )
        for log in logs
    ]


def weekly_summaries(points: list[SessionPoint], today: date) -> list[WeekSummary]:
    """Summaries for the complete weeks before the week containing `today`.

    Week 0 starts on the date of the course's first log, and weeks are 7-day blocks
    from there (OULAD: week = day // 7 from presentation start). Weeks without logs
    are zero activity, mirroring the OULAD gap-fill.
    """
    if not points:
        return []
    week0_start = min(p.day for p in points)
    target_week = (today - week0_start).days // WEEK_DAYS
    if target_week <= 0:
        return []

    weeks: list[list[SessionPoint]] = [[] for _ in range(target_week)]
    for point in points:
        week = (point.day - week0_start).days // WEEK_DAYS
        if 0 <= week < target_week:
            weeks[week].append(point)

    summaries = []
    for week_points in weeks:
        if not week_points:
            summaries.append(WeekSummary(adherence=0.0, active_days=0, focus=0.0))
            continue
        planned = sum(p.planned_minutes for p in week_points)
        actual = sum(p.actual_minutes for p in week_points)
        # Like OULAD's expected_clicks == 0, a zero denominator leaves adherence missing.
        adherence = min(max(actual / planned, 0.0), 1.0) if planned > 0 else None
        summaries.append(
            WeekSummary(
                adherence=adherence,
                active_days=min(len({p.day for p in week_points}), WEEK_DAYS),
                focus=min(max(mean(p.focus_score for p in week_points), 0.0), 1.0),
            )
        )
    return summaries


def forecast_features(summaries: list[WeekSummary]) -> dict[str, float | None]:
    """Training features for the week after `summaries` (see ml/build_oulad_canonical.py)."""
    t = len(summaries)

    def back(k: int) -> WeekSummary | None:
        return summaries[t - k] if t >= k else None

    recent = [w for w in (back(1), back(2), back(3)) if w is not None]
    lag1, lag2 = back(1), back(2)
    adh_lag1 = lag1.adherence if lag1 else None
    adh_lag2 = lag2.adherence if lag2 else None
    available_adherence = [w.adherence for w in recent if w.adherence is not None]

    return {
        "adh_lag1": adh_lag1,
        "adh_lag2": adh_lag2,
        "adh_mean3": mean(available_adherence) if available_adherence else None,
        "adh_trend": adh_lag1 - adh_lag2 if adh_lag1 is not None and adh_lag2 is not None else None,
        "active_days_lag1": float(lag1.active_days) if lag1 else None,
        "active_days_mean3": mean(w.active_days for w in recent) if recent else None,
        "focus_lag1": lag1.focus if lag1 else None,
        "weeks_history": float(t),
    }


# -- model loading ---------------------------------------------------------------


def _model_version(meta: dict[str, Any]) -> str:
    name = str(meta.get("model_name", "adherence_forecast"))
    try:
        stamp = datetime.fromisoformat(str(meta["created_at"])).strftime("%Y%m%dT%H%M%S")
        version = f"{name}@{stamp}"
    except (KeyError, ValueError):
        version = name
    return version[:MODEL_VERSION_MAX_LENGTH]


def _major_minor(version: str) -> tuple[str, ...]:
    return tuple(str(version).split(".")[:2])


@lru_cache(maxsize=1)
def get_model() -> LoadedModel | None:
    """Load the model and its meta file once. Returns None (and logs why) if unusable."""
    model_path = Path(settings.ADHERENCE_MODEL_PATH)
    meta_path = model_path.with_suffix(".meta.json")
    try:
        if not model_path.exists() or not meta_path.exists():
            logger.warning("Adherence model or meta file missing: %s, %s", model_path, meta_path)
            return None
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        trained_with = str(meta["sklearn_version"])
        if _major_minor(trained_with) != _major_minor(sklearn.__version__):
            logger.warning(
                "Adherence model was trained with scikit-learn %s but %s is installed; not loading it.",
                trained_with,
                sklearn.__version__,
            )
            return None
        feature_order = [str(name) for name in meta["feature_order"]]
        unsupported = [name for name in feature_order if name not in SUPPORTED_FEATURES]
        if unsupported:
            logger.warning("Adherence model expects features this app can't compute: %s", unsupported)
            return None
        with warnings.catch_warnings():
            warnings.simplefilter("error", category=InconsistentVersionWarning)
            pipeline = joblib.load(model_path)
        return LoadedModel(
            pipeline=pipeline,
            feature_order=feature_order,
            version=_model_version(meta),
            min_weeks_history=int(meta.get("min_weeks_history", DEFAULT_MIN_WEEKS_HISTORY)),
        )
    except Exception:
        logger.warning("Adherence model could not be loaded from %s", model_path, exc_info=True)
        return None


# -- forecasting -----------------------------------------------------------------


def forecast_from_points(points: list[SessionPoint], today: date) -> ForecastResult:
    summaries = weekly_summaries(points, today)
    features = forecast_features(summaries)
    weeks_history = len(summaries)
    loaded = get_model()
    version = loaded.version if loaded else None
    min_weeks = loaded.min_weeks_history if loaded else DEFAULT_MIN_WEEKS_HISTORY

    if weeks_history < min_weeks:
        return ForecastResult(STATUS_INSUFFICIENT_HISTORY, None, version, weeks_history, features)
    if loaded is None:
        return ForecastResult(STATUS_MODEL_UNAVAILABLE, None, None, weeks_history, features)

    try:
        row = [[np.nan if features[name] is None else features[name] for name in loaded.feature_order]]
        frame = pd.DataFrame(row, columns=loaded.feature_order, dtype=float)
        prediction = float(np.clip(loaded.pipeline.predict(frame)[0], 0.0, 1.0))
    except Exception:
        logger.warning("Adherence prediction failed", exc_info=True)
        return ForecastResult(STATUS_PREDICTION_FAILED, None, version, weeks_history, features)
    return ForecastResult(STATUS_OK, prediction, version, weeks_history, features)


def forecast_course(user, course_name: str, now: datetime | None = None) -> ForecastResult:
    """Forecast `course_name`'s adherence for the week containing `now`."""
    from .models import StudySessionLog

    now = now or timezone.now()
    logs = StudySessionLog.objects.filter(
        user=user, course_name=course_name, created_at__lte=now
    ).only("created_at", "planned_minutes", "actual_minutes", "focus_score")
    today = timezone.localtime(now, timezone.get_default_timezone()).date()
    return forecast_from_points(session_points(logs), today)
