"""Build the OULAD weekly panel for the next-week adherence forecast.

One row per (id_student, code_module, code_presentation, week) over each
registration's enrolled span, gap-filled with zero activity. Features for week t
are computed only from weeks < t of the same registration, and only from signals
the app can derive from its own StudySessionLog history.
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[2]

KEY = ["id_student", "code_module", "code_presentation"]
WEEK_DAYS = 7

TRAIN_PRESENTATIONS = ("2013B", "2013J")
VAL_PRESENTATIONS = ("2014B",)
TEST_PRESENTATIONS = ("2014J",)

MIN_WEEKS_HISTORY = 2

TARGET_COLUMN = "adherence"
# Model features: only signals the app can reproduce on the same scale.
FEATURE_COLUMNS = [
    "adh_lag1",
    "adh_lag2",
    "adh_mean3",
    "adh_trend",
    "weeks_history",
]
# Computed with the same prior-weeks-only rule, kept in the panel for reporting but
# NOT model features: the app's per-course active days sit on a lower scale than
# OULAD's, and its focus is a self-reported slider rather than click intensity.
REPORTING_COLUMNS = [
    "active_days_lag1",
    "active_days_mean3",
    "focus_lag1",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the OULAD weekly panel for the next-week adherence forecast."
    )
    parser.add_argument(
        "--input-dir",
        default=str(REPO_ROOT / "Dataset"),
        help="Directory containing OULAD CSV files (default: <repo>/Dataset).",
    )
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "backend" / "ml" / "data" / "oulad"),
        help="Directory to write forecast_panel.csv and forecast_metadata.json.",
    )
    parser.add_argument(
        "--chunksize",
        type=int,
        default=500000,
        help="CSV chunk size for studentVle processing (default: 500000).",
    )
    return parser.parse_args()


def build_enrolled_weeks(registrations: pd.DataFrame, courses: pd.DataFrame):
    """Expand registrations into one row per enrolled week.

    A registration's enrolled span ends at end_day = min(module_presentation_length,
    date_unregistration if present). Only full weeks count: weeks 0 .. end_day // 7 - 1.
    Registrations that unregistered before day 0 are excluded.
    """
    reg = registrations.merge(
        courses, how="left", on=["code_module", "code_presentation"], validate="many_to_one"
    )
    stats = {"registrations_total": int(len(reg))}

    unreg = reg["date_unregistration"]
    unregistered_before_start = unreg.notna() & (unreg < 0)
    stats["registrations_excluded_unregistered_before_day_0"] = int(unregistered_before_start.sum())
    reg = reg.loc[~unregistered_before_start].copy()

    length = reg["module_presentation_length"].astype(float)
    end_day = np.where(
        reg["date_unregistration"].notna(),
        np.minimum(length, reg["date_unregistration"]),
        length,
    )
    reg["n_weeks"] = (end_day // WEEK_DAYS).astype(int)
    no_full_week = reg["n_weeks"] <= 0
    stats["registrations_excluded_no_full_enrolled_week"] = int(no_full_week.sum())
    reg = reg.loc[~no_full_week]

    stats["registrations_in_panel"] = int(len(reg))
    stats["registrations_unregistered_mid_presentation"] = int(reg["date_unregistration"].notna().sum())
    stats["registrations_late_after_day_0"] = int((reg["date_registration"] > 0).sum())

    repeated = reg.loc[reg.index.repeat(reg["n_weeks"]), KEY].copy()
    repeated["week"] = repeated.groupby(level=0).cumcount()
    grid = repeated.reset_index(drop=True)
    grid["id_student"] = grid["id_student"].astype("int64")
    return grid, stats


def aggregate_weekly_activity(chunks: Iterable[pd.DataFrame]):
    """Aggregate studentVle chunks to weekly total_clicks and active_days.

    Clicks with date < 0 (before the presentation starts) are ignored. Days are
    re-aggregated after concatenation because one day can straddle two chunks.
    """
    stats = {"vle_rows_read": 0, "vle_rows_ignored_negative_date": 0}
    daily_parts: list[pd.DataFrame] = []
    for chunk in chunks:
        stats["vle_rows_read"] += int(len(chunk))
        negative = chunk["date"] < 0
        stats["vle_rows_ignored_negative_date"] += int(negative.sum())
        chunk = chunk.loc[~negative]
        daily = chunk.groupby(KEY + ["date"], as_index=False, observed=True)["sum_click"].sum()
        for col in ("code_module", "code_presentation"):
            daily[col] = daily[col].astype(str)
        daily_parts.append(daily)

    daily_df = (
        pd.concat(daily_parts, ignore_index=True)
        .groupby(KEY + ["date"], as_index=False)["sum_click"]
        .sum()
    )
    daily_df["week"] = daily_df["date"] // WEEK_DAYS
    weekly = daily_df.groupby(KEY + ["week"], as_index=False).agg(
        total_clicks=("sum_click", "sum"),
        active_days=("date", "size"),
    )
    weekly["id_student"] = weekly["id_student"].astype("int64")
    weekly["week"] = weekly["week"].astype("int64")
    return weekly, stats


def assemble_panel(grid: pd.DataFrame, weekly: pd.DataFrame):
    """Left-join weekly activity onto the enrolled-week grid; empty weeks become zeros."""
    panel = grid.merge(weekly, how="left", on=KEY + ["week"], validate="one_to_one", indicator=True)
    panel["gap_filled"] = panel["_merge"] == "left_only"
    panel = panel.drop(columns="_merge")
    panel["total_clicks"] = panel["total_clicks"].fillna(0).astype("int64")
    panel["active_days"] = panel["active_days"].fillna(0).astype("int64")

    n_weeks = grid.groupby(KEY, as_index=False)["week"].max()
    n_weeks["n_weeks"] = n_weeks.pop("week") + 1
    located = weekly.merge(n_weeks, how="left", on=KEY)
    no_registration = located["n_weeks"].isna()
    after_span = ~no_registration & (located["week"] >= located["n_weeks"])
    stats = {
        "panel_rows": int(len(panel)),
        "gap_filled_rows": int(panel["gap_filled"].sum()),
        "activity_weeks_dropped_registration_excluded_or_missing": int(no_registration.sum()),
        "activity_clicks_dropped_registration_excluded_or_missing": int(
            located.loc[no_registration, "total_clicks"].sum()
        ),
        "activity_weeks_dropped_after_enrolled_span": int(after_span.sum()),
        "activity_clicks_dropped_after_enrolled_span": int(located.loc[after_span, "total_clicks"].sum()),
    }
    return panel, stats


def add_target(panel: pd.DataFrame) -> pd.DataFrame:
    """expected_clicks = median weekly clicks over all enrolled students (zeros included).

    adherence = clip(total_clicks / expected_clicks, 0, 1); undefined when expected_clicks == 0.
    """
    panel = panel.copy()
    panel["expected_clicks"] = panel.groupby(["code_module", "code_presentation", "week"])[
        "total_clicks"
    ].transform("median")
    expected = panel["expected_clicks"].to_numpy(dtype=float)
    clicks = panel["total_clicks"].to_numpy(dtype=float)
    ratio = np.divide(clicks, expected, out=np.full_like(clicks, np.nan), where=expected > 0)
    panel[TARGET_COLUMN] = np.clip(ratio, 0, 1)
    return panel


def compute_focus_p90(panel: pd.DataFrame) -> float:
    """P90 of clicks per active day over active weeks in non-test presentations."""
    mask = (~panel["code_presentation"].isin(TEST_PRESENTATIONS)) & (panel["active_days"] > 0)
    if not mask.any():
        raise ValueError("No active weeks in non-test presentations; cannot compute P90.")
    clicks_per_day = panel.loc[mask, "total_clicks"] / panel.loc[mask, "active_days"]
    p90 = float(np.percentile(clicks_per_day, 90))
    if p90 <= 0:
        raise ValueError(f"P90 of clicks per active day is {p90}; expected > 0.")
    return p90


def add_features(panel: pd.DataFrame, p90: float) -> pd.DataFrame:
    """Lag features for week t, using only weeks < t of the same registration."""
    panel = panel.sort_values(KEY + ["week"]).reset_index(drop=True)
    reg_id = panel.groupby(KEY, sort=False).ngroup()
    groups = panel.groupby(reg_id, sort=False)
    if not (groups.cumcount() == panel["week"]).all():
        raise ValueError("Enrolled weeks must be contiguous from week 0 within each registration.")

    adh = {k: groups[TARGET_COLUMN].shift(k) for k in (1, 2, 3)}
    days = {k: groups["active_days"].shift(k).astype(float) for k in (1, 2, 3)}
    clicks_lag1 = groups["total_clicks"].shift(1).astype(float)

    panel["adh_lag1"] = adh[1]
    panel["adh_lag2"] = adh[2]
    panel["adh_mean3"] = pd.concat([adh[1], adh[2], adh[3]], axis=1).mean(axis=1, skipna=True)
    panel["adh_trend"] = adh[1] - adh[2]
    panel["active_days_lag1"] = days[1]
    panel["active_days_mean3"] = pd.concat([days[1], days[2], days[3]], axis=1).mean(axis=1, skipna=True)
    panel["focus_lag1"] = ((clicks_lag1 / np.maximum(days[1], 1)) / p90).clip(lower=0, upper=1)
    panel["weeks_history"] = panel["week"].astype("int64")
    return panel


def assign_split(panel: pd.DataFrame) -> pd.DataFrame:
    """Split by presentation so no student-week crosses train, validation and test."""
    panel = panel.copy()
    presentation = panel["code_presentation"]
    panel["split"] = np.select(
        [
            presentation.isin(TRAIN_PRESENTATIONS),
            presentation.isin(VAL_PRESENTATIONS),
            presentation.isin(TEST_PRESENTATIONS),
        ],
        ["train", "validation", "test"],
        default="unused",
    )
    panel["is_training_row"] = (panel["weeks_history"] >= MIN_WEEKS_HISTORY) & panel[TARGET_COLUMN].notna()
    return panel


def build_panel(registrations: pd.DataFrame, courses: pd.DataFrame, vle_chunks: Iterable[pd.DataFrame]):
    grid, reg_stats = build_enrolled_weeks(registrations, courses)
    weekly, vle_stats = aggregate_weekly_activity(vle_chunks)
    panel, panel_stats = assemble_panel(grid, weekly)
    panel = add_target(panel)
    p90 = compute_focus_p90(panel)
    panel = add_features(panel, p90)
    panel = assign_split(panel)
    stats = {**reg_stats, **vle_stats, **panel_stats}
    return panel, stats, p90


def read_vle_chunks(input_dir: Path, chunksize: int):
    dtype = {
        "code_module": "category",
        "code_presentation": "category",
        "id_student": "int32",
        "id_site": "int32",
        "date": "int16",
        "sum_click": "int32",
    }
    yield from pd.read_csv(
        input_dir / "studentVle.csv",
        dtype=dtype,
        usecols=["code_module", "code_presentation", "id_student", "date", "sum_click"],
        chunksize=chunksize,
    )


PANEL_COLUMNS = KEY + [
    "week",
    "split",
    "gap_filled",
    "total_clicks",
    "active_days",
    "expected_clicks",
    TARGET_COLUMN,
    *FEATURE_COLUMNS,
    *REPORTING_COLUMNS,
    "is_training_row",
]


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    courses = pd.read_csv(input_dir / "courses.csv")
    registrations = pd.read_csv(input_dir / "studentRegistration.csv")
    panel, stats, p90 = build_panel(registrations, courses, read_vle_chunks(input_dir, args.chunksize))

    expected_zero = panel["expected_clicks"] == 0
    zero_cells = panel.loc[expected_zero, ["code_module", "code_presentation", "week"]].drop_duplicates()
    stats["rows_expected_clicks_zero"] = int(expected_zero.sum())
    stats["module_presentation_weeks_expected_clicks_zero"] = int(len(zero_cells))
    stats["rows_with_defined_target"] = int(panel[TARGET_COLUMN].notna().sum())
    stats["rows_week_0_or_1_no_target_history"] = int((panel["weeks_history"] < MIN_WEEKS_HISTORY).sum())
    stats["rows_excluded_from_training_expected_clicks_zero"] = int(
        (expected_zero & (panel["weeks_history"] >= MIN_WEEKS_HISTORY)).sum()
    )

    training = panel.loc[panel["is_training_row"]]
    split_counts = {
        split: {
            "panel_rows": int((panel["split"] == split).sum()),
            "training_rows": int((training["split"] == split).sum()),
            "registrations": int(training.loc[training["split"] == split, KEY].drop_duplicates().shape[0]),
        }
        for split in ("train", "validation", "test")
    }

    panel_path = output_dir / "forecast_panel.csv"
    panel[PANEL_COLUMNS].to_csv(panel_path, index=False, float_format="%.6g")

    metadata = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_dir": str(input_dir),
        "output_file": str(panel_path),
        "week_definition": "week = date // 7, from week 0; clicks with date < 0 are ignored",
        "span_rules": {
            "end_day": "min(module_presentation_length, date_unregistration if present)",
            "enrolled_weeks": "0 .. end_day // 7 - 1 (full weeks only; a partial final week is dropped)",
            "excluded": "registrations with date_unregistration < 0, and registrations with no full enrolled week",
            "start": "week 0 for every registration, including late registrations (date_registration > 0)",
            "gap_fill": "enrolled weeks without studentVle rows get total_clicks = 0, active_days = 0",
        },
        "target_definition": {
            "expected_clicks": "median total_clicks over all enrolled students per module/presentation/week, zeros included",
            "adherence": "clip(total_clicks / expected_clicks, 0, 1); missing when expected_clicks == 0",
        },
        "feature_columns": FEATURE_COLUMNS,
        "feature_definitions": {
            "adh_lag1": "adherence at t-1 (missing if expected_clicks was 0)",
            "adh_lag2": "adherence at t-2",
            "adh_mean3": "mean of available adherence at t-1..t-3",
            "adh_trend": "adh_lag1 - adh_lag2",
            "weeks_history": "number of enrolled weeks before t (= t)",
        },
        "reporting_columns": REPORTING_COLUMNS,
        "reporting_column_note": "computed from weeks < t like the features, but not model inputs (no app-comparable scale)",
        "reporting_column_definitions": {
            "active_days_lag1": "active days at t-1 (0-7)",
            "active_days_mean3": "mean of active days at t-1..t-3 (available weeks)",
            "focus_lag1": "clip((clicks_{t-1} / max(active_days_{t-1}, 1)) / P90, 0, 1)",
        },
        "focus_p90_clicks_per_active_day": p90,
        "focus_p90_definition": "90th percentile of clicks per active day over weeks with active_days > 0 in non-test presentations; used only by the focus_lag1 reporting column",
        "focus_p90_presentations": sorted(TRAIN_PRESENTATIONS + VAL_PRESENTATIONS),
        "splits": {
            "train": list(TRAIN_PRESENTATIONS),
            "validation": list(VAL_PRESENTATIONS),
            "test": list(TEST_PRESENTATIONS),
        },
        "training_row_rule": f"weeks_history >= {MIN_WEEKS_HISTORY} and adherence defined",
        "counts": stats,
        "split_counts": split_counts,
        "elapsed_seconds": round(time.perf_counter() - started, 1),
    }
    metadata_path = output_dir / "forecast_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Wrote {len(panel)} rows to {panel_path}")
    print(json.dumps({"counts": stats, "split_counts": split_counts, "p90": p90}, indent=2))
    print(f"Metadata written to {metadata_path}")


if __name__ == "__main__":
    main()
