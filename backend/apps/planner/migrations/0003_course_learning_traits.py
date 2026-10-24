import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("planner", "0002_unique_course_per_user"),
    ]

    operations = [
        migrations.AddField(
            model_name="course",
            name="learning_demands",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="course",
            name="builds_on_earlier",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="course",
            name="assessment_format",
            field=models.CharField(
                blank=True,
                choices=[
                    ("timed_problem_exam", "Timed problem exam"),
                    ("multiple_choice", "Multiple choice"),
                    ("essay_exam", "Essay exam"),
                    ("coursework", "Coursework"),
                    ("continuous_quizzes", "Continuous quizzes"),
                ],
                default="",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="course",
            name="exam_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="course",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="course",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
