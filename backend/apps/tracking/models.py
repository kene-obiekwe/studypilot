from django.contrib.auth.models import User
from django.db import models


class StudySessionLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="study_logs")
    course_name = models.CharField(max_length=120)
    planned_minutes = models.IntegerField()
    actual_minutes = models.IntegerField()
    focus_score = models.FloatField(default=0.5)
    completion_rate = models.FloatField(default=0.0)
    adherence_score = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

