"""One current plan per week: existing plans become revisions.

For each (user, week_start), the newest plan (by created_at, then id) stays current and the older
ones are marked superseded, numbered 1..n in creation order. Nothing is deleted. Reversing drops
the new fields and the constraint; the rows themselves are untouched either way.
"""

from django.db import migrations, models
from django.utils import timezone


def mark_revisions(apps, schema_editor):
    StudyPlan = apps.get_model("planner", "StudyPlan")
    weeks: dict[tuple[int, object], list] = {}
    for plan in StudyPlan.objects.order_by("user_id", "week_start", "created_at", "id"):
        weeks.setdefault((plan.user_id, plan.week_start), []).append(plan)
    for plans in weeks.values():
        for index, plan in enumerate(plans):
            newer = plans[index + 1] if index + 1 < len(plans) else None
            StudyPlan.objects.filter(pk=plan.pk).update(
                revision=index + 1,
                is_current=newer is None,
                superseded_at=newer.created_at if newer is not None else None,
                updated_at=plan.created_at,
            )


class Migration(migrations.Migration):
    dependencies = [
        ("planner", "0003_course_learning_traits"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyplan",
            name="revision",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="studyplan",
            name="is_current",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="studyplan",
            name="superseded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studyplan",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, default=timezone.now),
            preserve_default=False,
        ),
        migrations.RunPython(mark_revisions, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="studyplan",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_current", True)),
                fields=("user", "week_start"),
                name="one_current_plan_per_week",
            ),
        ),
    ]
