"""One-time emailed codes for verifying an email address, resetting a password and changing email.

Codes are 6 digits, expire after 15 minutes and die after 5 wrong guesses. Only a salted hash is
stored. Issuing a code replaces the user's earlier codes for that purpose, and a new one can only
be issued once the resend cooldown has passed. An email-change code is sent to the new address,
which it stores until it is confirmed.
"""

import logging
import math
import secrets
from datetime import timedelta

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


def send_code(user: User, purpose: str) -> bool:
    """Issue a code and email it. A failure to send is logged, never raised, and never logs the code."""
    code = issue_code(user, purpose)
    if code is None:
        return False
    return deliver_code(user, purpose, code)


def deliver_code(user: User, purpose: str, code: str, to: str = "") -> bool:
    """Email an issued code to `to` (the account's address by default). Failures are logged, not raised."""
    try:
        send_code_email(user, purpose, code, to=to)
    except Exception:
        logger.warning("Could not send a %s code email to user %s", purpose, user.pk, exc_info=True)
        return False
    return True


def notify_email_changed(user: User, old_email: str) -> None:
    """Tell the old address about an email change. A failure is logged and ignored."""
    if not old_email:
        return
    try:
        send_email_changed_notice(user, old_email)
    except Exception:
        logger.warning("Could not send the email-changed notice for user %s", user.pk, exc_info=True)


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
