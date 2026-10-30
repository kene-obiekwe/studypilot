"""Logging of shown strategies (one row per user, course, strategy and ISO week) and their feedback.

Ratings (helpful / not helpful) also live in StrategyRating, per user and course, so they outlast the week.
"""

from __future__ import annotations

from datetime import date, datetime

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from apps.planner.models import Course

from .engine.diagnostics import RatingInfo
from .engine.gather import local_today
from .engine.selection import RATING_HELPFUL, is_resting
from .models import RATING_VALUES, ShownStrategy, StrategyFeedback, StrategyFeedbackValue, StrategyRating


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


def feedback_state(shown_ids: list[int], ratings: dict[int, str | None] | None = None) -> dict[int, dict]:
    """Per shown row: its rating and whether it was tried this week.

    The rating comes from `ratings` (shown id -> the StrategyRating value that counts today) when
    given. Without it, as for a row whose course was deleted, it is the row's own rating feedback.
    """
    states = {shown_id: {"rating": None, "tried": False} for shown_id in shown_ids}
    for shown_id, value in StrategyFeedback.objects.filter(shown_id__in=shown_ids).values_list("shown_id", "value"):
        if value == StrategyFeedbackValue.TRIED:
            states[shown_id]["tried"] = True
        elif ratings is None:
            states[shown_id]["rating"] = value
    for shown_id, value in (ratings or {}).items():
        states[shown_id]["rating"] = value
    return states


def _set_rating(shown: ShownStrategy, value: str, now: datetime) -> None:
    """Upsert the persistent rating. Repeating the current value keeps rated_at, so the rest window doesn't restart."""
    rating, created = StrategyRating.objects.get_or_create(
        user_id=shown.user_id,
        course_id=shown.course_id,
        strategy_id=shown.strategy_id,
        defaults={"value": value, "rated_at": now},
    )
    if created:
        return
    # A not_helpful whose rest is over counts as no rating, so choosing it again starts a new rest.
    # Same day-based rule as the engine's is_resting, so both agree on the day the rest ends.
    rest_over = value == StrategyFeedbackValue.NOT_HELPFUL and not is_resting(
        RatingInfo(rating.value, local_today(rating.rated_at)), local_today(now)
    )
    if rating.value != value or rating.cleared_at is not None or rest_over:
        rating.value, rating.rated_at, rating.cleared_at = value, now, None
        rating.save()


def current_rating(shown: ShownStrategy, today: date) -> str | None:
    rating = StrategyRating.objects.filter(
        user_id=shown.user_id, course_id=shown.course_id, strategy_id=shown.strategy_id, cleared_at__isnull=True
    ).first()
    if rating is None:
        return None
    counts = rating.value == RATING_HELPFUL or is_resting(RatingInfo(rating.value, local_today(rating.rated_at)), today)
    return rating.value if counts else None


@transaction.atomic
def record_feedback(shown: ShownStrategy, value: str, now: datetime | None = None) -> dict:
    """helpful and not_helpful replace each other; tried is independent. Repeats are no-ops.

    A rating is also kept for the course across weeks (StrategyRating); tried stays on this week's row.
    """
    now = now or timezone.now()
    if value in RATING_VALUES:
        StrategyFeedback.objects.filter(shown=shown, value__in=RATING_VALUES).exclude(value=value).delete()
        if shown.course_id is not None:
            _set_rating(shown, value, now)
    feedback, created = StrategyFeedback.objects.get_or_create(shown=shown, value=value)
    if not created:
        feedback.save(update_fields=["updated_at"])
    ratings = {shown.id: current_rating(shown, local_today(now))} if shown.course_id is not None else None
    return {"shown_id": shown.id, **feedback_state([shown.id], ratings)[shown.id]}


@transaction.atomic
def clear_rating(user, course: Course, strategy_id: str, now: datetime | None = None) -> bool:
    """"Show again": the rating stops counting. False when there was none.

    The row is kept, with cleared_at set, so its updated_at still outdates a saved AI plan.
    """
    now = now or timezone.now()
    return (
        StrategyRating.objects.filter(user=user, course=course, strategy_id=strategy_id, cleared_at__isnull=True).update(
            cleared_at=now, updated_at=now
        )
        > 0
    )
