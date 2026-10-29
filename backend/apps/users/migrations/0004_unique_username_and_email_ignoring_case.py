from collections import Counter

from django.db import migrations

# auth_user belongs to Django's auth app, so the indexes are created here with SQL. Both work on SQLite and Postgres.
CREATE_USERNAME_INDEX = "CREATE UNIQUE INDEX auth_user_username_lower_uniq ON auth_user (LOWER(username))"
CREATE_EMAIL_INDEX = "CREATE UNIQUE INDEX auth_user_email_lower_uniq ON auth_user (LOWER(email)) WHERE email <> ''"


def refuse_case_duplicates(apps, schema_editor):
    """Fail with a message that says what to fix, instead of a bare database error from the index."""
    User = apps.get_model("auth", "User")
    users = list(User.objects.values_list("username", "email"))
    usernames = Counter(username.lower() for username, _ in users)
    emails = Counter(email.lower() for _, email in users if email)
    names = sorted(name for name, count in usernames.items() if count > 1)
    addresses = sorted(address for address, count in emails.items() if count > 1)
    if names or addresses:
        raise RuntimeError(
            "Cannot add the unique indexes: some accounts differ only by letter case "
            f"(usernames: {names or 'none'}; emails: {addresses or 'none'}). "
            "Run `python manage.py list_case_duplicate_usernames`, delete or rename one account of each pair, "
            "then migrate again."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("users", "0003_email_change"),
    ]

    operations = [
        migrations.RunPython(refuse_case_duplicates, migrations.RunPython.noop),
        migrations.RunSQL(
            sql=[CREATE_USERNAME_INDEX, CREATE_EMAIL_INDEX],
            reverse_sql=[
                "DROP INDEX auth_user_email_lower_uniq",
                "DROP INDEX auth_user_username_lower_uniq",
            ],
        ),
    ]
