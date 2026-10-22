from django.db import migrations, models
from django.db.models import Count, Max


def remove_duplicate_courses(apps, schema_editor):
    """Keep the highest-id Course for each (user, name); delete the exact duplicates."""
    Course = apps.get_model("planner", "Course")
    duplicates = (
        Course.objects.order_by()
        .values("user_id", "name")
        .annotate(keep_id=Max("id"), total=Count("id"))
        .filter(total__gt=1)
    )
    for row in list(duplicates):
        Course.objects.filter(user_id=row["user_id"], name=row["name"]).exclude(id=row["keep_id"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("planner", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(remove_duplicate_courses, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="course",
            constraint=models.UniqueConstraint(fields=("user", "name"), name="unique_course_per_user"),
        ),
    ]
