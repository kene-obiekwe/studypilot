from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_mark_existing_users_verified"),
    ]

    operations = [
        migrations.AddField(
            model_name="onetimecode",
            name="pending_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
        migrations.AlterField(
            model_name="onetimecode",
            name="purpose",
            field=models.CharField(
                choices=[("verify", "Verify email"), ("reset", "Reset password"), ("email", "Change email")],
                max_length=10,
            ),
        ),
    ]
