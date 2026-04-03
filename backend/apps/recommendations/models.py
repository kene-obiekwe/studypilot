from django.contrib.auth.models import User
from django.db import models


class RecommendationLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recommendation_logs")
    focus_score = models.FloatField()
    completion_rate = models.FloatField()
    preferred_style = models.CharField(max_length=20)
    strategies_json = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
