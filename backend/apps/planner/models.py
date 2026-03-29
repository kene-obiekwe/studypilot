from django.contrib.auth.models import User
from django.db import models


class Course(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="courses")
    name = models.CharField(max_length=120)
    difficulty = models.IntegerField(default=3)
    weekly_target_hours = models.FloatField(default=3.0)


class StudyPlan(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="study_plans")
    week_start = models.DateField()
    plan_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
