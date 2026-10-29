"""List accounts whose usernames, or emails, differ only by letter case. Read-only: nothing is changed or deleted.

Usernames were case-sensitive before registration started rejecting case-only duplicates, and emails were never
unique in the database, so older databases can hold pairs such as "kene" and "Kene". Signing in as either still
works by its exact name; any other casing is refused until one of the accounts is renamed or removed by hand.
The migration that adds the unique indexes fails until every pair listed here is gone.

Usage (from backend/):

    python manage.py list_case_duplicate_usernames
"""

from collections import defaultdict

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from apps.users.verification import is_verified


class Command(BaseCommand):
    help = "List groups of usernames, and of emails, that differ only by letter case (read-only)."

    def handle(self, *args, **options):
        users = list(User.objects.select_related("email_verification").order_by("date_joined", "id"))
        found = self.report("usernames", users, lambda user: user.username.casefold())
        found += self.report("emails", [user for user in users if user.email], lambda user: user.email.lower())
        if found:
            self.stdout.write(f"{found} group(s) found. Nothing was changed.")

    def report(self, label: str, users: list[User], key) -> int:
        groups: dict[str, list[User]] = defaultdict(list)
        for user in users:
            groups[key(user)].append(user)
        duplicates = [members for members in groups.values() if len(members) > 1]
        if not duplicates:
            self.stdout.write(f"No {label} differ only by case.")
            return 0
        for members in sorted(duplicates, key=lambda group: key(group[0])):
            self.stdout.write(f"{label[:-1]} {key(members[0])}: {len(members)} accounts")
            for user in members:
                last_login = user.last_login.isoformat(timespec="seconds") if user.last_login else "never"
                self.stdout.write(
                    f"  id={user.pk} username={user.username} email={user.email or '-'} "
                    f"joined={user.date_joined.isoformat(timespec='seconds')} "
                    f"verified={'yes' if is_verified(user) else 'no'} last_login={last_login}"
                )
        return len(duplicates)
