from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from django.conf import settings

FEATURE_COLUMNS = [
    "planned_minutes",
    "actual_minutes",
    "completion_rate",
    "sessions_last_7_days",
    "focus_score",
    "help_seeking_rate",
    "consistency_score",
    "avg_quiz_score_recent",
    "created_at",
]

MODEL_VERSION = "oulad_adherence_v1"
MODEL_PATH = Path(settings.BASE_DIR) / "ml" / "models" / "oulad_adherence_model.joblib"


def build_feature_payload(
    *,
    planned_minutes: int,
    actual_minutes: int,
    completion_rate: float,
    sessions_last_7_days: int,
    focus_score: float,
    consistency_score: float,
    created_at_offset_days: int,
    help_seeking_rate: float | None = None,
    avg_quiz_score_recent: float | None = None,
) -> dict[str, Any]:
    return {
        "planned_minutes": planned_minutes,
        "actual_minutes": actual_minutes,
        "completion_rate": completion_rate,
        "sessions_last_7_days": sessions_last_7_days,
        "focus_score": focus_score,
        "help_seeking_rate": help_seeking_rate,
        "consistency_score": consistency_score,
        "avg_quiz_score_recent": avg_quiz_score_recent,
        "created_at": created_at_offset_days,
    }


@lru_cache(maxsize=1)
def get_model():
    if not MODEL_PATH.exists():
        return None
    try:
        return joblib.load(MODEL_PATH)
    except Exception:
        return None


def predict_adherence(features: dict[str, Any]) -> tuple[float | None, str]:
    model = get_model()
    if model is None:
        return None, "model_unavailable"

    try:
        df = pd.DataFrame([features], columns=FEATURE_COLUMNS)
        prediction = float(model.predict(df)[0])
        prediction = float(np.clip(prediction, 0.0, 1.0))
        return prediction, MODEL_VERSION
    except Exception:
        return None, "prediction_failed"
