"""One-time emailed codes for verifying an email address, resetting a password and changing email.

Codes are 6 digits, expire after 15 minutes and die after 5 wrong guesses. Only a salted hash is
stored. Issuing a code replaces the user's earlier codes for that purpose, and a new one can only
be issued once the resend cooldown has passed. An email-change code is sent to the new address,
which it stores until it is confirmed.
"""

import logging
import math
import secrets
import threading
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .emails import send_code_email, send_email_changed_notice
from .models import EmailVerification, OneTimeCode

logger = logging.getLogger(__name__)

CODE_LENGTH = 6
CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
# An account that never verified its email is deleted this long after it was created.
UNVERIFIED_ACCOUNT_TTL = timedelta(days=7)


def generate_code() -> str:
    return f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"


def is_verified(user: User) -> bool:
    record = getattr(user, "email_verification", None)
    return bool(record and record.email_verified_at)


def mark_verified(user: User) -> None:
    EmailVerification.objects.update_or_create(user=user, defaults={"email_verified_at": timezone.now()})


def users_with_email(email: str, limit: int | None = None) -> list[User]:
    """Accounts whose address matches `email` ignoring case, lowest id first. Email is not unique in the
    database, so callers that must not guess between accounts ask for two and check the count."""
    matches = User.objects.filter(email__iexact=email.strip()).select_related("email_verification").order_by("id")
    return list(matches[:limit] if limit else matches)


def email_in_use(email: str, exclude: User | None = None) -> bool:
    """True when an account other than `exclude` has this address, ignoring case."""
    matches = User.objects.filter(email__iexact=email.strip())
    if exclude is not None:
        matches = matches.exclude(pk=exclude.pk)
    return matches.exists()


def find_user_by_email(email: str) -> User | None:
    matches = users_with_email(email, 1)
    return matches[0] if matches else None


def expired_unverified_users():
    """Accounts that never verified their email and are older than UNVERIFIED_ACCOUNT_TTL. Staff and
    superusers are never included: `createsuperuser` makes accounts with no verification record."""
    return User.objects.filter(
        date_joined__lt=timezone.now() - UNVERIFIED_ACCOUNT_TTL, is_staff=False, is_superuser=False
    ).exclude(email_verification__email_verified_at__isnull=False)


def purge_expired_conflicts(username: str, email: str) -> None:
    """Delete expired unverified accounts that hold `username` or `email` (ignoring case)."""
    expired = expired_unverified_users()
    expired.filter(username__iexact=username).delete()
    expired.filter(email__iexact=email.strip()).delete()


def issue_code(user: User, purpose: str, pending_email: str = "") -> str | None:
    """Create a fresh code and return it, or None while the resend cooldown is running."""
    now = timezone.now()
    with transaction.atomic():
        latest = OneTimeCode.objects.filter(user=user, purpose=purpose).order_by("-created_at", "-id").first()
        if latest is not None and now - latest.created_at < RESEND_COOLDOWN:
            return None
        OneTimeCode.objects.filter(user=user, purpose=purpose).delete()
        code = generate_code()
        OneTimeCode.objects.create(
            user=user,
            purpose=purpose,
            code_hash=make_password(code),
            expires_at=now + CODE_TTL,
            pending_email=pending_email,
        )
    return code


def cooldown_seconds_left(user: User, purpose: str) -> int:
    """Whole seconds until a new code for `purpose` may be issued (0 when it may be now)."""
    latest = OneTimeCode.objects.filter(user=user, purpose=purpose).order_by("-created_at", "-id").first()
    if latest is None:
        return 0
    left = (latest.created_at + RESEND_COOLDOWN - timezone.now()).total_seconds()
    return max(0, math.ceil(left))


def decoy_work() -> None:
    """Hash a throwaway code, so a request that sends nothing costs about what one that issues a code does."""
    make_password("000000")


def run_after_commit(task, *args) -> None:
    """Run `task(*args)` once the surrounding transaction commits: on a background thread when
    EMAIL_SEND_IN_BACKGROUND is on, so the request never waits on SMTP, otherwise right here. `args` must be
    plain values: the thread never touches the database or a model instance. A gunicorn worker restart can
    drop an email that is still in flight; the user can ask for another."""
    if not settings.EMAIL_SEND_IN_BACKGROUND:
        task(*args)
        return
    transaction.on_commit(lambda: threading.Thread(target=task, args=args, daemon=True).start())


def send_code(user: User, purpose: str) -> bool:
    """Issue a code and email it. A failure to send is logged, never raised, and never logs the code."""
    code = issue_code(user, purpose)
    if code is None:
        return False
    deliver_code(user, purpose, code)
    return True


def _send_code_now(user_id: int, to: str, username: str, purpose: str, code: str) -> None:
    try:
        send_code_email(to, username, purpose, code)
    except Exception:
        logger.warning("Could not send a %s code email to user %s", purpose, user_id, exc_info=True)


def deliver_code(user: User, purpose: str, code: str, to: str = "") -> None:
    """Email an issued code to `to` (the account's address by default). Failures are logged, not raised."""
    run_after_commit(_send_code_now, user.pk, to or user.email, user.username, purpose, code)


def _send_notice_now(user_id: int, to: str, username: str, new_email: str) -> None:
    try:
        send_email_changed_notice(to, username, new_email)
    except Exception:
        logger.warning("Could not send the email-changed notice for user %s", user_id, exc_info=True)


def notify_email_changed(user: User, old_email: str) -> None:
    """Tell the old address about an email change. A failure is logged and ignored."""
    if not old_email:
        return
    run_after_commit(_send_notice_now, user.pk, old_email, user.username, user.email)


def check_code(user: User, purpose: str, code: str) -> OneTimeCode | None:
    """Return the user's live code record if `code` matches it.

    Each wrong guess uses up one of the 5 attempts; the fifth wrong guess kills the code, even for
    the right digits afterwards. An expired, used or exhausted code never matches.
    The caller marks the record used (see `consume`) once it has finished its own checks.
    """
    now = timezone.now()
    with transaction.atomic():
        record = (
            OneTimeCode.objects.select_for_update()
            .filter(user=user, purpose=purpose, used_at__isnull=True)
            .order_by("-created_at", "-id")
            .first()
        )
        if record is None or record.expires_at <= now or record.attempts >= MAX_ATTEMPTS:
            return None
        if check_password(code, record.code_hash):
            return record
        record.attempts += 1
        record.save(update_fields=["attempts"])
        return None


def consume(record: OneTimeCode) -> None:
    record.used_at = timezone.now()
    record.save(update_fields=["used_at"])
    # Anything else issued for this user and purpose is dead too.
    OneTimeCode.objects.filter(user=record.user, purpose=record.purpose).exclude(pk=record.pk).delete()


def invalidate_all_codes(user: User) -> None:
    OneTimeCode.objects.filter(user=user).delete()
