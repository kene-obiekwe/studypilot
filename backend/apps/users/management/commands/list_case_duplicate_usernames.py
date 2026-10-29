"""List accounts whose usernames differ only by letter case. Read-only: nothing is changed or deleted.

Usernames were case-sensitive before registration started rejecting case-only duplicates, so older
databases can hold pairs such as "kene" and "Kene". Signing in as either still works by its exact
name; any other casing is refused until one of the accounts is renamed or removed by hand.

Usage (from backend/):

    python manage.py list_case_duplicate_usernames
"""

from collections import defaultdict

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from apps.users.verification import is_verified


class Command(BaseCommand):
    help = "List groups of usernames that differ only by letter case (read-only)."

    def handle(self, *args, **options):
        groups: dict[str, list[User]] = defaultdict(list)
        users = User.objects.select_related("email_verification").order_by("date_joined", "id")
        for user in users:
            groups[user.username.casefold()].append(user)
        duplicates = [members for members in groups.values() if len(members) > 1]
        if not duplicates:
            self.stdout.write("No usernames differ only by case.")
            return
        for members in sorted(duplicates, key=lambda group: group[0].username.casefold()):
            self.stdout.write(f"{members[0].username.casefold()}: {len(members)} accounts")
            for user in members:
                last_login = user.last_login.isoformat(timespec="seconds") if user.last_login else "never"
                self.stdout.write(
                    f"  id={user.pk} username={user.username} email={user.email or '-'} "
                    f"joined={user.date_joined.isoformat(timespec='seconds')} "
                    f"verified={'yes' if is_verified(user) else 'no'} last_login={last_login}"
                )
        self.stdout.write(f"{len(duplicates)} group(s) found. Nothing was changed.")
