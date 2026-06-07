"""Compute SUS scores and summary statistics from a Google Form CSV export.

Usage:
    python docs/evaluation/score_sus.py docs/evaluation/data/sus-responses.csv

Outputs (next to the CSV, in the same directory):
    sus-scores.csv          -- per-participant scores (raw + converted + total)
    sus-summary.json        -- mean, median, std, n, grade interpretation
    sus-histogram.png       -- distribution of SUS scores (for §4.3.3)

The script assumes the ten SUS items appear in the CSV in the standard order
documented in docs/evaluation/sus-questionnaire.md. Two background questions
(year of study; prior use of a study planner) may appear before the SUS items
and are passed through to the per-participant output without affecting scoring.

Scoring follows Brooke (1986):
    Odd-numbered items (1, 3, 5, 7, 9):  contribution = response - 1
    Even-numbered items (2, 4, 6, 8, 10): contribution = 5 - response
    Sum all contributions (0-40), multiply by 2.5 -> SUS score in [0, 100].

Grade bands (Sauro & Lewis, 2016):
    A+ (84.1-100), A (80.8-84.0), B (71.1-80.7), C (51.7-71.0),
    D (39.0-51.6), F (<39.0).
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:  # pragma: no cover
    plt = None


SUS_ITEM_KEYWORDS = (
    "would like to use this system frequently",            # 1 (positive)
    "unnecessarily complex",                                # 2 (negative)
    "easy to use",                                          # 3 (positive)
    "support of a technical person",                        # 4 (negative)
    "well integrated",                                      # 5 (positive)
    "inconsistency",                                        # 6 (negative)
    "learn to use this system very quickly",                # 7 (positive)
    "cumbersome",                                           # 8 (negative)
    "felt very confident",                                  # 9 (positive)
    "needed to learn a lot",                                # 10 (negative)
)


def grade_for(score: float) -> str:
    if score >= 84.1:
        return "A+ (Best imaginable)"
    if score >= 80.8:
        return "A (Excellent)"
    if score >= 71.1:
        return "B (Good)"
    if score >= 51.7:
        return "C (OK)"
    if score >= 39.0:
        return "D (Poor)"
    return "F (Worst imaginable)"


def locate_sus_columns(header: list[str]) -> list[int]:
    """Return ten column indices in the canonical SUS order."""
    indices: list[int] = []
    for needle in SUS_ITEM_KEYWORDS:
        match: int | None = None
        for i, col in enumerate(header):
            if needle.lower() in col.lower():
                match = i
                break
        if match is None:
            raise SystemExit(
                "Could not find SUS item containing the phrase "
                f"'{needle}'. Confirm the questionnaire wording in sus-questionnaire.md "
                "and that all ten items are present in the CSV."
            )
        indices.append(match)
    return indices


def score_response(values: list[int]) -> tuple[list[int], int, float]:
    """Return (per-item converted, raw total 0-40, SUS 0-100)."""
    if len(values) != 10:
        raise ValueError(f"Expected 10 SUS values, got {len(values)}")
    converted: list[int] = []
    for i, v in enumerate(values, start=1):
        if v < 1 or v > 5:
            raise ValueError(f"Item {i} response {v} is outside 1-5 range")
        if i % 2 == 1:
            converted.append(v - 1)
        else:
            converted.append(5 - v)
    raw_total = sum(converted)
    return converted, raw_total, raw_total * 2.5


def parse_int(cell: str, item_no: int) -> int:
    cell = cell.strip()
    if not cell:
        raise ValueError(f"Item {item_no} is blank")
    try:
        return int(cell)
    except ValueError:
        raise ValueError(f"Item {item_no} value '{cell}' is not an integer in 1-5")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("csv_path", help="Path to the Google Forms CSV export")
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory for outputs (default: alongside the CSV)",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")
    out_dir = Path(args.out_dir) if args.out_dir else csv_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        raise SystemExit("CSV is empty.")
    header, *data_rows = rows
    sus_idx = locate_sus_columns(header)

    per_participant: list[dict] = []
    sus_scores: list[float] = []

    for n, row in enumerate(data_rows, start=1):
        if not any(cell.strip() for cell in row):
            continue
        try:
            values = [parse_int(row[i], item_no=k + 1) for k, i in enumerate(sus_idx)]
        except ValueError as exc:
            print(f"Skipping respondent {n}: {exc}", file=sys.stderr)
            continue
        converted, raw_total, sus = score_response(values)
        sus_scores.append(sus)
        entry: dict = {"respondent": n}
        for k, raw in enumerate(values, start=1):
            entry[f"item_{k}_raw"] = raw
        for k, c in enumerate(converted, start=1):
            entry[f"item_{k}_conv"] = c
        entry["raw_total"] = raw_total
        entry["sus_score"] = round(sus, 2)
        entry["grade"] = grade_for(sus)
        per_participant.append(entry)

    if not per_participant:
        raise SystemExit("No valid responses found.")

    scores_csv = out_dir / "sus-scores.csv"
    fieldnames = list(per_participant[0].keys())
    with scores_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(per_participant)

    mean_score = statistics.mean(sus_scores)
    median_score = statistics.median(sus_scores)
    std_score = statistics.stdev(sus_scores) if len(sus_scores) > 1 else 0.0
    min_score = min(sus_scores)
    max_score = max(sus_scores)

    summary = {
        "n": len(sus_scores),
        "mean": round(mean_score, 2),
        "median": round(median_score, 2),
        "std": round(std_score, 2),
        "min": round(min_score, 2),
        "max": round(max_score, 2),
        "mean_grade": grade_for(mean_score),
        "above_industry_average_count": sum(1 for s in sus_scores if s >= 68.0),
        "industry_average_reference": 68.0,
        "grade_distribution": {
            "A+": sum(1 for s in sus_scores if s >= 84.1),
            "A": sum(1 for s in sus_scores if 80.8 <= s < 84.1),
            "B": sum(1 for s in sus_scores if 71.1 <= s < 80.8),
            "C": sum(1 for s in sus_scores if 51.7 <= s < 71.1),
            "D": sum(1 for s in sus_scores if 39.0 <= s < 51.7),
            "F": sum(1 for s in sus_scores if s < 39.0),
        },
    }

    summary_path = out_dir / "sus-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    histogram_path = out_dir / "sus-histogram.png"
    if plt is not None:
        bins = [0, 25, 39, 51.7, 68, 71.1, 80.8, 84.1, 100]
        plt.figure(figsize=(7, 4.5))
        plt.hist(sus_scores, bins=bins, color="#4a90c9", edgecolor="#14304d")
        plt.axvline(68.0, color="#d46172", linestyle="--", linewidth=1.4, label="Industry average (68)")
        plt.axvline(mean_score, color="#2fa07c", linestyle="-", linewidth=1.8, label=f"This study mean ({mean_score:.1f})")
        plt.xlabel("SUS score")
        plt.ylabel("Number of participants")
        plt.title("Distribution of SUS scores")
        plt.legend()
        plt.tight_layout()
        plt.savefig(histogram_path, dpi=160)
        plt.close()
    else:
        print("matplotlib not available; skipping histogram PNG.", file=sys.stderr)

    print(f"Wrote {scores_csv}")
    print(f"Wrote {summary_path}")
    if plt is not None:
        print(f"Wrote {histogram_path}")
    print()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
