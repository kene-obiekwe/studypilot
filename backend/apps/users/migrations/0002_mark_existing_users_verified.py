from django.conf import settings
from django.db import migrations
from django.utils import timezone


def mark_existing_users_verified(apps, schema_editor):
    """Accounts that exist before email verification was introduced keep working."""
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    EmailVerification = apps.get_model("users", "EmailVerification")
    now = timezone.now()
    already = set(EmailVerification.objects.values_list("user_id", flat=True))
    EmailVerification.objects.bulk_create(
        [
            EmailVerification(user_id=user_id, email_verified_at=now)
            for user_id in User.objects.values_list("id", flat=True)
            if user_id not in already
        ]
    )
    EmailVerification.objects.filter(email_verified_at__isnull=True).update(email_verified_at=now)


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(mark_existing_users_verified, migrations.RunPython.noop),
    ]
