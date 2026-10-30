"""Send one test event to Sentry, to check that SENTRY_DSN is right.

Render's free plan has no shell, so run this on your own computer with SENTRY_DSN set to the backend project's
DSN. The event is labelled environment "local-check", so it is easy to tell from real errors. The DSN is never printed.

Usage (from backend/), in PowerShell:

    $env:SENTRY_DSN = "https://...your backend DSN..."
    python manage.py sentry_check
"""

import sentry_sdk
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.common.monitoring import init_sentry

FLUSH_SECONDS = 10


class Command(BaseCommand):
    help = "Send one test event to Sentry (environment local-check). Needs SENTRY_DSN."

    def handle(self, *args, **options):
        dsn = settings.SENTRY_DSN
        self.stdout.write(f"SENTRY_DSN is {'set' if dsn else 'not set'}.")
        if not dsn:
            raise CommandError("Set SENTRY_DSN in the environment first, then run this again.")
        # settings.py may already have started Sentry as "production" or "development"; start it again so the
        # test event is labelled "local-check".
        init_sentry(dsn, environment="local-check")
        sentry_sdk.capture_message("StudyPilot sentry_check test event", level="info")
        sentry_sdk.flush(timeout=FLUSH_SECONDS)
        self.stdout.write(
            self.style.SUCCESS("Test event sent. It should appear in the Sentry project's Issues within a minute.")
        )
