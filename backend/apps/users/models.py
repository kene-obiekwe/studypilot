from django.contrib.auth.models import User
from django.db import models


class EmailVerification(models.Model):
    """Whether a user has proven they own their email address.

    A user with no row, or a row with no timestamp, is unverified and cannot obtain API tokens.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="email_verification")
    email_verified_at = models.DateTimeField(null=True, blank=True)


class OneTimeCode(models.Model):
    """A short-lived 6-digit code emailed to a user. Only a hash of the code is stored.

    An email-change code also holds the address it was sent to, which becomes the account's email
    once the code is confirmed. The client never sends that address again.
    """

    class Purpose(models.TextChoices):
        VERIFY = "verify", "Verify email"
        RESET = "reset", "Reset password"
        EMAIL_CHANGE = "email", "Change email"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="one_time_codes")
    purpose = models.CharField(max_length=10, choices=Purpose.choices)
    code_hash = models.CharField(max_length=255)
    pending_email = models.EmailField(blank=True, default="")
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class UserPreferences(models.Model):
    """Per-user settings. A user with no row, or a blank time zone, uses settings.TIME_ZONE.

    Rows are created on the first write, so adding the table changes nothing for existing users.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="preferences")
    # An IANA name such as "Africa/Lagos". Blank means not set yet.
    time_zone = models.CharField(max_length=64, blank=True, default="")
    # True while the zone follows the device; picking a zone by hand turns it off.
    time_zone_auto = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
