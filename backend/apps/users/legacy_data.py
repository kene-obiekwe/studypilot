"""Test helper: databases from before the unique indexes may hold accounts that differ only by case."""

from django.db import connection

UNIQUE_INDEXES = ("auth_user_username_lower_uniq", "auth_user_email_lower_uniq")


def allow_legacy_duplicates() -> None:
    """Drop the case-insensitive unique indexes so a test can create the pairs old databases still hold.
    The drop is rolled back with the test's transaction."""
    with connection.cursor() as cursor:
        for name in UNIQUE_INDEXES:
            cursor.execute(f"DROP INDEX {name}")
