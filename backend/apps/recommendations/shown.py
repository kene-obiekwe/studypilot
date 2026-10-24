"""Logging of shown strategies (one row per user, course, strategy and ISO week) and their feedback."""

from __future__ import annotations

from datetime import date, datetime

from django.db import IntegrityError, transaction
from django.db.models import F

from apps.planner.models import Course

from .models import RATING_VALUES, ShownStrategy, StrategyFeedback, StrategyFeedbackValue


def log_shown(user, course: Course, recommendations: list[dict], monday: date, now: datetime) -> dict[str, ShownStrategy]:
    """Upsert a ShownStrategy per recommendation; showing it again in the same week reuses the row."""
    shown: dict[str, ShownStrategy] = {}
    for rec in recommendations:
        key = {"user": user, "course": course, "strategy_id": rec["strategy_id"], "week_start": monday}
        fields = {
            "course_name": course.name,
            "priority": rec["priority"],
            "basis": rec["basis"],
            "triggers": rec["triggers"],
            "last_shown_at": now,
        }
        try:
            with transaction.atomic():
                row, created = ShownStrategy.objects.get_or_create(**key, defaults=fields)
        except IntegrityError:  # a concurrent request created it first
            row, created = ShownStrategy.objects.get(**key), False
        if not created:
            ShownStrategy.objects.filter(pk=row.pk).update(times_shown=F("times_shown") + 1, **fields)
        shown[rec["strategy_id"]] = row
    return shown


def feedback_state(shown_ids: list[int]) -> dict[int, dict]:
    states = {shown_id: {"rating": None, "tried": False} for shown_id in shown_ids}
    for shown_id, value in StrategyFeedback.objects.filter(shown_id__in=shown_ids).values_list("shown_id", "value"):
        if value == StrategyFeedbackValue.TRIED:
            states[shown_id]["tried"] = True
        else:
            states[shown_id]["rating"] = value
    return states


@transaction.atomic
def record_feedback(shown: ShownStrategy, value: str) -> dict:
    """helpful and not_helpful replace each other; tried is independent. Repeats are no-ops."""
    if value in RATING_VALUES:
        StrategyFeedback.objects.filter(shown=shown, value__in=RATING_VALUES).exclude(value=value).delete()
    feedback, created = StrategyFeedback.objects.get_or_create(shown=shown, value=value)
    if not created:
        feedback.save(update_fields=["updated_at"])
    return {"shown_id": shown.id, **feedback_state([shown.id])[shown.id]}
