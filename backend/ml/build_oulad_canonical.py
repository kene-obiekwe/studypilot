import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd


CANONICAL_COLUMNS = [
    "user_id",
    "planned_minutes",
    "actual_minutes",
    "completion_rate",
    "sessions_last_7_days",
    "focus_score",
    "help_seeking_rate",
    "consistency_score",
    "avg_quiz_score_recent",
    "created_at",
    "adherence_score",
    "strategy_label",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a canonical training dataset from OULAD using proxy features."
    )
    parser.add_argument(
        "--input-dir",
        default="dataset",
        help="Directory containing OULAD CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        default="backend/ml/data/oulad",
        help="Directory to write training_dataset.csv and metadata.json.",
    )
    parser.add_argument(
        "--window-size",
        type=int,
        default=7,
        help="Window size in days for aggregation (default: 7).",
    )
    parser.add_argument(
        "--clicks-per-minute",
        type=float,
        default=5.0,
        help="Scaling factor to convert clicks to estimated minutes (default: 5).",
    )
    parser.add_argument(
        "--chunksize",
        type=int,
        default=500000,
        help="CSV chunk size for studentVle processing (default: 500000).",
    )
    return parser.parse_args()


def load_vle_map(input_dir: Path) -> pd.DataFrame:
    vle_path = input_dir / "vle.csv"
    vle_df = pd.read_csv(vle_path)
    vle_df["activity_type"] = vle_df["activity_type"].fillna("")
    help_keywords = (
        "forum",
        "wiki",
        "collab",
        "oucontent",
        "resource",
        "page",
        "subpage",
    )
    vle_df["is_help"] = vle_df["activity_type"].str.contains(
        "|".join(help_keywords), case=False, regex=True
    )
    return vle_df[["id_site", "is_help"]], list(help_keywords)


def build_activity_windows(
    input_dir: Path,
    vle_map: pd.DataFrame,
    window_size: int,
    chunksize: int,
) -> pd.DataFrame:
    student_vle_path = input_dir / "studentVle.csv"

    dtype = {
        "code_module": "category",
        "code_presentation": "category",
        "id_student": "int32",
        "id_site": "int32",
        "date": "int16",
        "sum_click": "int32",
    }

    daily_parts: list[pd.DataFrame] = []
    for chunk in pd.read_csv(student_vle_path, dtype=dtype, chunksize=chunksize):
        chunk = chunk.merge(vle_map, how="left", on="id_site")
        chunk["is_help"] = chunk["is_help"].fillna(False)
        chunk["window_start"] = (chunk["date"] // window_size) * window_size
        chunk["help_clicks"] = np.where(chunk["is_help"], chunk["sum_click"], 0)

        daily = (
            chunk.groupby(
                [
                    "id_student",
                    "code_module",
                    "code_presentation",
                    "window_start",
                    "date",
                ],
                as_index=False,
                observed=True,
            )
            .agg(total_clicks=("sum_click", "sum"), help_clicks=("help_clicks", "sum"))
        )
        daily_parts.append(daily)

    daily_df = pd.concat(daily_parts, ignore_index=True)
    daily_df = (
        daily_df.groupby(
            [
                "id_student",
                "code_module",
                "code_presentation",
                "window_start",
                "date",
            ],
            as_index=False,
            observed=True,
        )
        .agg(total_clicks=("total_clicks", "sum"), help_clicks=("help_clicks", "sum"))
    )

    window_df = (
        daily_df.groupby(
            ["id_student", "code_module", "code_presentation", "window_start"],
            as_index=False,
            observed=True,
        )
        .agg(
            total_clicks=("total_clicks", "sum"),
            help_clicks=("help_clicks", "sum"),
            active_days=("date", "nunique"),
        )
    )
    window_df["avg_clicks_per_active_day"] = np.where(
        window_df["active_days"] > 0,
        window_df["total_clicks"] / window_df["active_days"],
        0,
    )
    return window_df


def build_assessment_windows(input_dir: Path, window_size: int) -> pd.DataFrame:
    assessments_path = input_dir / "assessments.csv"
    student_assess_path = input_dir / "studentAssessment.csv"

    assessments = pd.read_csv(assessments_path)
    student_assess = pd.read_csv(student_assess_path)

    merged = student_assess.merge(assessments, how="left", on="id_assessment")
    merged["assessment_date"] = np.where(
        merged["date_submitted"] >= 0,
        merged["date_submitted"],
        merged["date"],
    )
    merged["window_start"] = (merged["assessment_date"] // window_size) * window_size

    window_scores = (
        merged.groupby(
            ["id_student", "code_module", "code_presentation", "window_start"],
            as_index=False,
            observed=True,
        )
        .agg(mean_score=("score", "mean"))
    )
    return window_scores


def clip_01(values):
    if isinstance(values, pd.Series):
        return values.clip(lower=0, upper=1)
    return np.clip(values, 0, 1)


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    vle_map, help_keywords = load_vle_map(input_dir)
    activity_windows = build_activity_windows(
        input_dir,
        vle_map,
        window_size=args.window_size,
        chunksize=args.chunksize,
    )
    assessment_windows = build_assessment_windows(input_dir, window_size=args.window_size)

    window_df = activity_windows.merge(
        assessment_windows,
        how="left",
        on=["id_student", "code_module", "code_presentation", "window_start"],
    )

    expected_clicks = (
        window_df.groupby(
            ["code_module", "code_presentation", "window_start"],
            as_index=False,
            observed=True,
        )
        .agg(expected_clicks=("total_clicks", "median"))
    )
    window_df = window_df.merge(
        expected_clicks,
        how="left",
        on=["code_module", "code_presentation", "window_start"],
    )

    clicks_per_minute = max(args.clicks_per_minute, 1e-6)
    window_df["actual_minutes"] = window_df["total_clicks"] / clicks_per_minute
    window_df["planned_minutes"] = window_df["expected_clicks"] / clicks_per_minute

    engagement_ratio = np.where(
        window_df["expected_clicks"] > 0,
        window_df["total_clicks"] / window_df["expected_clicks"],
        0,
    )

    window_df["completion_rate"] = np.where(
        window_df["mean_score"].notna(),
        window_df["mean_score"] / 100.0,
        engagement_ratio,
    )

    p90 = np.percentile(window_df["avg_clicks_per_active_day"], 90) if len(window_df) else 1.0
    p90 = p90 if p90 > 0 else 1.0
    window_df["focus_score"] = clip_01(window_df["avg_clicks_per_active_day"] / p90)

    window_df["help_seeking_rate"] = np.where(
        window_df["total_clicks"] > 0,
        window_df["help_clicks"] / window_df["total_clicks"],
        np.nan,
    )

    window_df["consistency_score"] = clip_01(window_df["active_days"] / args.window_size)
    window_df["sessions_last_7_days"] = window_df["active_days"]
    window_df["avg_quiz_score_recent"] = window_df["mean_score"] / 100.0
    window_df["created_at"] = window_df["window_start"] + (args.window_size - 1)

    window_df["adherence_score"] = clip_01(engagement_ratio)
    window_df["strategy_label"] = ""

    output_df = pd.DataFrame(
        {
            "user_id": window_df["id_student"],
            "planned_minutes": window_df["planned_minutes"],
            "actual_minutes": window_df["actual_minutes"],
            "completion_rate": clip_01(window_df["completion_rate"]),
            "sessions_last_7_days": window_df["sessions_last_7_days"],
            "focus_score": window_df["focus_score"],
            "help_seeking_rate": window_df["help_seeking_rate"],
            "consistency_score": window_df["consistency_score"],
            "avg_quiz_score_recent": window_df["avg_quiz_score_recent"],
            "created_at": window_df["created_at"],
            "adherence_score": window_df["adherence_score"],
            "strategy_label": window_df["strategy_label"],
        }
    )

    output_df = output_df[CANONICAL_COLUMNS]

    output_path = output_dir / "training_dataset.csv"
    output_df.to_csv(output_path, index=False)

    metadata = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "input_dir": str(input_dir),
        "output_file": str(output_path),
        "row_count": int(len(output_df)),
        "window_size_days": args.window_size,
        "clicks_per_minute": args.clicks_per_minute,
        "help_keywords": help_keywords,
        "proxy_definitions": {
            "actual_minutes": "total_clicks / clicks_per_minute",
            "planned_minutes": "median total_clicks per module/presentation/window / clicks_per_minute",
            "completion_rate": "mean assessment score (if available) else engagement_ratio",
            "focus_score": "avg_clicks_per_active_day scaled by p90",
            "help_seeking_rate": "help_clicks / total_clicks using activity_type keywords",
            "consistency_score": "active_days / window_size",
            "adherence_score": "total_clicks / expected_clicks (clipped)",
            "created_at": "window_end_day (relative to presentation start)",
        },
        "missing_counts": output_df.isna().sum().to_dict(),
        "notes": [
            "created_at is a relative day index, not a calendar datetime.",
            "strategy_label is intentionally blank because OULAD has no strategy labels.",
        ],
    }

    metadata_path = output_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Wrote {len(output_df)} rows to {output_path}")
    print(f"Metadata written to {metadata_path}")


if __name__ == "__main__":
    main()
