from __future__ import annotations

import csv
import json
from collections import defaultdict, deque
from datetime import timedelta
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.planner.models import Course, StudyPlan
from apps.recommendations.models import RecommendationLog
from apps.tracking.models import StudySessionLog

STYLE_VALUES = {"visual", "reading", "practice", "mixed"}

SCHEMA_COLUMNS = [
    "user_id",
    "course_name",
    "difficulty",
    "planned_minutes",
    "actual_minutes",
    "focus_score",
    "completion_rate",
    "preferred_style",
    "sessions_last_7_days",
    "deadlines_within_7_days",
    "avg_quiz_score_recent",
    "created_at",
]

TARGET_COLUMNS = [
    "adherence_score",
    "strategy_label",
]

ALL_COLUMNS = SCHEMA_COLUMNS + TARGET_COLUMNS


def normalize_style(value: Any) -> str:
    style = str(value or "mixed").strip().lower()
    return style if style in STYLE_VALUES else "mixed"


def to_int(value: Any, default: int) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def to_float(value: Any, default: float | None = None) -> float | None:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clip_01(value: float) -> float:
    return max(0.0, min(1.0, value))


def clip_difficulty(value: int) -> int:
    return max(1, min(5, value))


def normalize_course_name(name: Any) -> str:
    return str(name or "").strip().lower()


def get_matching_course_payload(plan: StudyPlan | None, course_name: str) -> dict[str, Any] | None:
    if not plan or not isinstance(plan.plan_json, dict):
        return None

    courses = plan.plan_json.get("courses", [])
    if not isinstance(courses, list):
        return None

    target = normalize_course_name(course_name)
    for item in courses:
        if not isinstance(item, dict):
            continue
        if normalize_course_name(item.get("name")) == target:
            return item
    return None


def get_deadlines_within_7_days(plan: StudyPlan | None, course_name: str) -> int:
    if not plan or not isinstance(plan.plan_json, dict):
        return 0

    course_payload = get_matching_course_payload(plan, course_name) or {}
    sources = [course_payload, plan.plan_json]

    for source in sources:
        value = source.get("deadlines_within_7_days")
        if value is not None:
            return max(0, to_int(value, 0))

        value = source.get("deadline_within_7_days")
        if value is not None:
            return max(0, to_int(value, 0))

        days_to_deadline = source.get("days_to_deadline")
        if days_to_deadline is not None:
            return 1 if to_int(days_to_deadline, 999) <= 7 else 0

        deadline_in_days = source.get("deadline_in_days")
        if deadline_in_days is not None:
            return 1 if to_int(deadline_in_days, 999) <= 7 else 0

    return 0


def get_avg_quiz_score_recent(plan: StudyPlan | None, course_name: str) -> float | None:
    if not plan or not isinstance(plan.plan_json, dict):
        return None

    course_payload = get_matching_course_payload(plan, course_name) or {}
    for source in (course_payload, plan.plan_json):
        for key in ("avg_quiz_score_recent", "recent_avg_quiz_score", "quiz_score_recent"):
            parsed = to_float(source.get(key), None)
            if parsed is not None:
                return parsed
    return None


def safe_relative_path(path: Path) -> str:
    base_dir = Path(settings.BASE_DIR)
    try:
        return str(path.relative_to(base_dir)).replace("\\", "/")
    except ValueError:
        return str(path)


class Command(BaseCommand):
    help = "Build a schema-aligned training dataset snapshot from planner/recommendation/tracking tables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output-dir",
            default="",
            help="Directory where versioned snapshots are written. Defaults to backend/ml/data/snapshots/.",
        )
        parser.add_argument(
            "--snapshot-id",
            default="",
            help="Optional snapshot id. Defaults to timestamp format YYYYMMDD_HHMMSS.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional row limit for quick local checks (0 means all rows).",
        )

    def handle(self, *args, **options):
        default_output_dir = Path(settings.BASE_DIR) / "ml" / "data" / "snapshots"
        output_dir = Path(options["output_dir"]) if options["output_dir"] else default_output_dir
        snapshot_id = options["snapshot_id"] or timezone.now().strftime("%Y%m%d_%H%M%S")
        row_limit = max(0, int(options["limit"]))

        snapshot_dir = output_dir / snapshot_id
        if snapshot_dir.exists():
            raise CommandError(f"Snapshot directory already exists: {snapshot_dir}")

        snapshot_dir.mkdir(parents=True, exist_ok=False)
        csv_path = snapshot_dir / "training_dataset.csv"
        metadata_path = snapshot_dir / "metadata.json"

        total_sessions = StudySessionLog.objects.count()
        session_queryset = StudySessionLog.objects.order_by("user_id", "created_at")
        if row_limit:
            session_queryset = session_queryset[:row_limit]

        sessions = list(session_queryset)
        if not sessions:
            raise CommandError("No study session logs found. Cannot build training dataset snapshot.")

        courses_lookup: dict[tuple[int, str], int] = {}
        for course in Course.objects.all().only("user_id", "name", "difficulty"):
            key = (course.user_id, normalize_course_name(course.name))
            courses_lookup[key] = clip_difficulty(to_int(course.difficulty, 3))

        recommendations_by_user: dict[int, list[RecommendationLog]] = defaultdict(list)
        for recommendation in RecommendationLog.objects.order_by("user_id", "created_at").only(
            "user_id", "created_at", "preferred_style", "strategies_json"
        ):
            recommendations_by_user[recommendation.user_id].append(recommendation)

        plans_by_user: dict[int, list[StudyPlan]] = defaultdict(list)
        for plan in StudyPlan.objects.order_by("user_id", "created_at").only("user_id", "created_at", "plan_json"):
            plans_by_user[plan.user_id].append(plan)

        user_state: dict[int, dict[str, Any]] = defaultdict(
            lambda: {
                "recent_sessions": deque(),
                "recommendation_idx": -1,
                "plan_idx": -1,
            }
        )

        rows: list[dict[str, Any]] = []
        null_avg_quiz_count = 0
        for session in sessions:
            user_id = session.user_id
            state = user_state[user_id]

            recommendations = recommendations_by_user.get(user_id, [])
            while (
                state["recommendation_idx"] + 1 < len(recommendations)
                and recommendations[state["recommendation_idx"] + 1].created_at <= session.created_at
            ):
                state["recommendation_idx"] += 1

            matched_recommendation = (
                recommendations[state["recommendation_idx"]]
                if state["recommendation_idx"] >= 0
                else (recommendations[-1] if recommendations else None)
            )

            plans = plans_by_user.get(user_id, [])
            while (
                state["plan_idx"] + 1 < len(plans)
                and plans[state["plan_idx"] + 1].created_at <= session.created_at
            ):
                state["plan_idx"] += 1

            matched_plan = plans[state["plan_idx"]] if state["plan_idx"] >= 0 else None

            recent_sessions = state["recent_sessions"]
            cutoff = session.created_at - timedelta(days=7)
            while recent_sessions and recent_sessions[0] < cutoff:
                recent_sessions.popleft()
            recent_sessions.append(session.created_at)
            sessions_last_7_days = len(recent_sessions)

            course_key = (user_id, normalize_course_name(session.course_name))
            difficulty = courses_lookup.get(course_key)
            if difficulty is None:
                plan_course_payload = get_matching_course_payload(matched_plan, session.course_name) if matched_plan else None
                difficulty = clip_difficulty(to_int((plan_course_payload or {}).get("difficulty"), 3))

            preferred_style = normalize_style(
                matched_recommendation.preferred_style if matched_recommendation else "mixed"
            )

            planned_minutes = max(1, to_int(session.planned_minutes, 1))
            actual_minutes = max(0, to_int(session.actual_minutes, 0))
            adherence_score = clip_01(actual_minutes / planned_minutes)

            avg_quiz_score_recent = get_avg_quiz_score_recent(matched_plan, session.course_name)
            if avg_quiz_score_recent is None:
                null_avg_quiz_count += 1

            row = {
                "user_id": user_id,
                "course_name": session.course_name,
                "difficulty": difficulty,
                "planned_minutes": planned_minutes,
                "actual_minutes": actual_minutes,
                "focus_score": clip_01(float(session.focus_score)),
                "completion_rate": clip_01(float(session.completion_rate)),
                "preferred_style": preferred_style,
                "sessions_last_7_days": sessions_last_7_days,
                "deadlines_within_7_days": get_deadlines_within_7_days(matched_plan, session.course_name),
                "avg_quiz_score_recent": avg_quiz_score_recent,
                "created_at": session.created_at.isoformat(),
                "adherence_score": adherence_score,
                "strategy_label": preferred_style,
            }
            rows.append(row)

        with csv_path.open("w", encoding="utf-8", newline="") as dataset_file:
            writer = csv.DictWriter(dataset_file, fieldnames=ALL_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

        metadata = {
            "snapshot_id": snapshot_id,
            "generated_at": timezone.now().isoformat(),
            "schema_reference": "backend/ml/schema.md",
            "column_order": ALL_COLUMNS,
            "row_count": len(rows),
            "source_table_counts": {
                "study_session_log_total": total_sessions,
                "study_session_log_exported": len(rows),
                "study_plan": StudyPlan.objects.count(),
                "recommendation_log": RecommendationLog.objects.count(),
                "course": Course.objects.count(),
            },
            "defaults": {
                "difficulty_default": 3,
                "preferred_style_default": "mixed",
                "deadlines_within_7_days_default": 0,
                "strategy_label_default": "preferred_style",
            },
            "optional_field_null_counts": {
                "avg_quiz_score_recent": null_avg_quiz_count,
            },
            "files": {
                "training_dataset_csv": safe_relative_path(csv_path),
                "metadata_json": safe_relative_path(metadata_path),
            },
        }

        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        self.stdout.write(self.style.SUCCESS(f"Dataset snapshot created: {safe_relative_path(snapshot_dir)}"))
        self.stdout.write(self.style.SUCCESS(f"Rows exported: {len(rows)}"))