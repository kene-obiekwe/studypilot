from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


class RecommendationLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recommendation_logs")
    focus_score = models.FloatField()
    completion_rate = models.FloatField()
    preferred_style = models.CharField(max_length=20)
    strategies_json = models.JSONField(default=list)
    confidence = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)


class StrategyFeedbackValue(models.TextChoices):
    HELPFUL = "helpful", "Helpful"
    NOT_HELPFUL = "not_helpful", "Not helpful"
    TRIED = "tried", "Tried it"


RATING_VALUES = (StrategyFeedbackValue.HELPFUL, StrategyFeedbackValue.NOT_HELPFUL)


class ShownStrategy(models.Model):
    """A strategy shown to a user for a course, once per ISO week (logged for the 7.1 learning stage)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="shown_strategies")
    # Kept after the course is deleted, with its name as a snapshot, so feedback history survives.
    course = models.ForeignKey(
        "planner.Course", on_delete=models.SET_NULL, null=True, blank=True, related_name="shown_strategies"
    )
    course_name = models.CharField(max_length=120)
    strategy_id = models.CharField(max_length=50)
    week_start = models.DateField()
    priority = models.IntegerField()
    basis = models.CharField(max_length=20)
    triggers = models.JSONField(default=list, blank=True)
    times_shown = models.PositiveIntegerField(default=1)
    first_shown_at = models.DateTimeField(auto_now_add=True)
    last_shown_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "course", "strategy_id", "week_start"], name="unique_shown_strategy_per_week"
            ),
        ]


class StrategyFeedback(models.Model):
    shown = models.ForeignKey(ShownStrategy, on_delete=models.CASCADE, related_name="feedback")
    value = models.CharField(max_length=20, choices=StrategyFeedbackValue.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["shown", "value"], name="unique_feedback_value_per_shown"),
        ]
