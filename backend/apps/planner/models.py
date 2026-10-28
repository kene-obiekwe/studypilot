from django.contrib.auth.models import User
from django.db import models


class LearningDemand(models.TextChoices):
    PROBLEM_SOLVING = "problem_solving", "Problem solving"
    CONCEPTUAL = "conceptual", "Conceptual understanding"
    MEMORISATION = "memorisation", "Memorisation"
    WRITING = "writing", "Writing"
    PRACTICAL = "practical", "Practical work"


class AssessmentFormat(models.TextChoices):
    TIMED_PROBLEM_EXAM = "timed_problem_exam", "Timed problem exam"
    MULTIPLE_CHOICE = "multiple_choice", "Multiple choice"
    ESSAY_EXAM = "essay_exam", "Essay exam"
    COURSEWORK = "coursework", "Coursework"
    CONTINUOUS_QUIZZES = "continuous_quizzes", "Continuous quizzes"


MAX_LEARNING_DEMANDS = 3


class Course(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="courses")
    name = models.CharField(max_length=120)
    difficulty = models.IntegerField(default=3)
    weekly_target_hours = models.FloatField(default=3.0)
    # Learning traits, all optional. builds_on_earlier is None until the learner answers.
    learning_demands = models.JSONField(default=list, blank=True)
    builds_on_earlier = models.BooleanField(null=True, blank=True, default=None)
    assessment_format = models.CharField(max_length=30, choices=AssessmentFormat.choices, blank=True, default="")
    exam_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "name"], name="unique_course_per_user"),
        ]


class StudyPlan(models.Model):
    """One revision of a user's plan for a week (Monday-Sunday).

    Each week has at most one current revision; updating the plan supersedes it with the next
    revision, so earlier revisions stay as history. Session logs never reference a plan: they
    belong to a course by name.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="study_plans")
    week_start = models.DateField()
    plan_json = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    superseded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "week_start"],
                condition=models.Q(is_current=True),
                name="one_current_plan_per_week",
            ),
        ]
