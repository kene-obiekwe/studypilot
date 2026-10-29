"""Delete accounts that never verified their email and were created more than 7 days ago.

Verified accounts, staff and superusers are never touched. Deleting an account removes everything it owns
through the cascades. The deploy build runs this, since the free Render plan has no cron.

Usage (from backend/):

    python manage.py purge_unverified_accounts --dry-run   # list them, delete nothing
    python manage.py purge_unverified_accounts
"""

from django.core.management.base import BaseCommand

from apps.users.verification import UNVERIFIED_ACCOUNT_TTL, expired_unverified_users


class Command(BaseCommand):
    help = f"Delete accounts that never verified their email and are more than {UNVERIFIED_ACCOUNT_TTL.days} days old."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List the accounts and delete nothing.")

    def handle(self, *args, **options):
        users = list(expired_unverified_users().order_by("date_joined", "id"))
        if not users:
            self.stdout.write("No expired unverified accounts.")
            return
        for user in users:
            self.stdout.write(
                f"id={user.pk} username={user.username} email={user.email or '-'} "
                f"joined={user.date_joined.isoformat(timespec='seconds')}"
            )
        if options["dry_run"]:
            self.stdout.write(f"{len(users)} account(s) would be deleted. Nothing was changed (dry run).")
            return
        for user in users:
            user.delete()
        self.stdout.write(f"Deleted {len(users)} account(s).")
