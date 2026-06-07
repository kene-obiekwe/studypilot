from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0002_studysessionlog_adherence_score"),
    ]

    operations = [
        migrations.AddField(
            model_name="studysessionlog",
            name="predicted_adherence",
            field=models.FloatField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="studysessionlog",
            name="model_version",
            field=models.CharField(default="", max_length=50),
        ),
    ]
