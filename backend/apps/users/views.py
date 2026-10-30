from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenBlacklistView, TokenObtainPairView, TokenRefreshView

from .models import OneTimeCode, UserPreferences
from .serializers import (
    EMAIL_REGISTERED_MESSAGE,
    USERNAME_TAKEN_MESSAGE,
    AccountDeleteSerializer,
    EmailChangeConfirmSerializer,
    EmailChangeRequestSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendCodeSerializer,
    TimeZoneSerializer,
    UsernameChangeSerializer,
    VerifiedTokenObtainPairSerializer,
    VerifyEmailSerializer,
    password_errors,
    taken_field,
)
from .tokens import blacklist_user_tokens, issue_pair
from .verification import (
    check_code,
    consume,
    cooldown_seconds_left,
    decoy_work,
    deliver_code,
    email_in_use,
    find_user_by_email,
    invalidate_all_codes,
    is_verified,
    issue_code,
    mark_verified,
    notify_email_changed,
    send_code,
)

BAD_CODE_MESSAGE = "That code is incorrect or has expired. Request a new one."
RESEND_MESSAGE = "If that email belongs to an account that needs a code, we have sent one."
RESET_REQUEST_MESSAGE = "If that email belongs to an account, we have sent a password reset code."
RESET_DONE_MESSAGE = "Your password has been reset. You can sign in now."
PASSWORD_CHANGED_MESSAGE = "Your password has been changed."
EMAIL_TAKEN_SINCE_MESSAGE = "Another account now uses that email. Start again with a different address."


class EmailScopeThrottle(ScopedRateThrottle):
    """Throttles by the view's `email_throttle_scope`, so a view can also keep its `throttle_scope`."""

    scope_attr = "email_throttle_scope"


class EmailThrottledView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [EmailScopeThrottle]
    email_throttle_scope = "email"


class RegisterView(EmailThrottledView):
    """Creates an unverified account and emails a code. Retrying with the same username and email
    for a still-unverified account sets the new password and sends a fresh code instead of failing."""

    throttle_classes = [ScopedRateThrottle, EmailScopeThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.resend_user is not None:
            user = serializer.resend_user
            user.set_password(serializer.validated_data["password"])
            user.save(update_fields=["password"])
        else:
            try:
                user = serializer.save()
            except IntegrityError as exc:
                # Someone registered the same name or address between the checks and the insert.
                field = taken_field(exc)
                message = EMAIL_REGISTERED_MESSAGE if field == "email" else USERNAME_TAKEN_MESSAGE
                raise serializers.ValidationError({field: [message]}) from exc
        send_code(user, OneTimeCode.Purpose.VERIFY)
        return Response({"status": "verification_required", "email": user.email}, status=status.HTTP_201_CREATED)


class VerifyEmailView(EmailThrottledView):
    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        record = None
        if user is not None and not is_verified(user):
            record = check_code(user, OneTimeCode.Purpose.VERIFY, serializer.validated_data["code"])
        if record is None:
            return Response({"detail": BAD_CODE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            consume(record)
            mark_verified(user)
        return Response(issue_pair(user))


class ResendCodeView(EmailThrottledView):
    def post(self, request):
        serializer = ResendCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        # Every branch does the same hashing, so the answer's timing doesn't say whether the address has an account.
        if user is None or is_verified(user) or not send_code(user, OneTimeCode.Purpose.VERIFY):
            decoy_work()
        return Response({"detail": RESEND_MESSAGE})


class PasswordResetRequestView(EmailThrottledView):
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        if user is None or not user.is_active or not is_verified(user) or not send_code(user, OneTimeCode.Purpose.RESET):
            decoy_work()
        return Response({"detail": RESET_REQUEST_MESSAGE})


class PasswordResetConfirmView(EmailThrottledView):
    """Sets a new password when the emailed code is right.

    The code is checked first, so a wrong email or code gives the same answer whether or not the
    account exists. A weak password leaves the code usable. Every refresh token of the account is
    revoked (see tokens.py for what that misses).
    """

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = find_user_by_email(data["email"])
        record = None
        if user is not None and user.is_active and is_verified(user):
            record = check_code(user, OneTimeCode.Purpose.RESET, data["code"])
        if record is None:
            return Response({"detail": BAD_CODE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        problems = password_errors(data["new_password"], user)
        if problems:
            return Response({"new_password": problems}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            user.set_password(data["new_password"])
            user.save(update_fields=["password"])
            consume(record)
            invalidate_all_codes(user)
            blacklist_user_tokens(user)
        return Response({"detail": RESET_DONE_MESSAGE})


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = VerifiedTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class ThrottledTokenBlacklistView(TokenBlacklistView):
    """Sign out: revokes the refresh token in the body."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


def me_payload(user) -> dict:
    # No row means the zone was never set: the API says null and the server falls back to settings.TIME_ZONE.
    preferences = getattr(user, "preferences", None)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "time_zone": (preferences.time_zone or None) if preferences else None,
        "time_zone_auto": preferences.time_zone_auto if preferences else True,
    }


class MeView(APIView):
    """The signed-in user's own identity, for the app shell. Authenticated by the project default.

    PATCH changes the username under the registration rules; a change of case alone is allowed.
    """

    def get(self, request):
        return Response(me_payload(request.user))

    def patch(self, request):
        serializer = UsernameChangeSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.username = serializer.validated_data["username"]
        try:
            with transaction.atomic():
                user.save(update_fields=["username"])
        except IntegrityError as exc:
            raise serializers.ValidationError({"username": [USERNAME_TAKEN_MESSAGE]}) from exc
        return Response(me_payload(user))


class TimeZoneView(APIView):
    """Sets the zone that decides the user's days and weeks. Authenticated; no password, so it has its own throttle."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "time_zone"

    def put(self, request):
        serializer = TimeZoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        preferences, _ = UserPreferences.objects.update_or_create(
            user=user,
            defaults={
                "time_zone": serializer.validated_data["time_zone"],
                "time_zone_auto": serializer.validated_data["auto"],
            },
        )
        # Drop what zone_for cached on this instance and show the new row in the payload.
        user.preferences = preferences
        user.__dict__.pop("_clock_zone", None)
        return Response(me_payload(user))


class AccountView(APIView):
    """A signed-in change that checks the password: throttled like sign-in."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class PasswordChangeView(AccountView):
    """Sets a new password after checking the current one. Outstanding reset codes die with the old
    password, and so does every refresh token, so other devices are signed out on their next refresh.
    Access tokens stay valid until they expire. The reply carries a fresh pair for this session."""

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        user = request.user
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.save(update_fields=["password"])
            OneTimeCode.objects.filter(user=user, purpose=OneTimeCode.Purpose.RESET).delete()
            blacklist_user_tokens(user)
            tokens = issue_pair(user)
        return Response({"detail": PASSWORD_CHANGED_MESSAGE, **tokens})


class EmailChangeRequestView(AccountView):
    """Emails a code to the new address and remembers that address with the code. The account's
    email is unchanged until the code is confirmed. A newer request replaces an older one, once the
    resend cooldown has passed; asking again is also how a code is resent."""

    throttle_classes = [ScopedRateThrottle, EmailScopeThrottle]
    email_throttle_scope = "email"

    def post(self, request):
        serializer = EmailChangeRequestSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        user = request.user
        new_email = serializer.validated_data["new_email"]
        code = issue_code(user, OneTimeCode.Purpose.EMAIL_CHANGE, pending_email=new_email)
        if code is None:
            seconds = max(1, cooldown_seconds_left(user, OneTimeCode.Purpose.EMAIL_CHANGE))
            return Response(
                {"detail": f"Wait {seconds} seconds before asking for another code."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deliver_code(user, OneTimeCode.Purpose.EMAIL_CHANGE, code, to=new_email)
        return Response({"detail": f"We sent a code to {new_email}.", "email": new_email})


class EmailChangeConfirmView(AccountView):
    """Applies the pending address when its code is right, then tells the old address."""

    def post(self, request):
        serializer = EmailChangeConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        record = check_code(user, OneTimeCode.Purpose.EMAIL_CHANGE, serializer.validated_data["code"])
        if record is None or not record.pending_email:
            return Response({"detail": BAD_CODE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        new_email = record.pending_email
        if email_in_use(new_email, exclude=user):
            # Taken since the code was sent: this request is over.
            OneTimeCode.objects.filter(user=user, purpose=OneTimeCode.Purpose.EMAIL_CHANGE).delete()
            return Response({"detail": EMAIL_TAKEN_SINCE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        old_email = user.email
        try:
            with transaction.atomic():
                consume(record)
                user.email = new_email
                user.save(update_fields=["email"])
                mark_verified(user)
                # Codes sent to the old address (a password reset) must not outlive it.
                invalidate_all_codes(user)
        except IntegrityError:
            # Taken between the check above and the save.
            user.email = old_email
            OneTimeCode.objects.filter(user=user, purpose=OneTimeCode.Purpose.EMAIL_CHANGE).delete()
            return Response({"detail": EMAIL_TAKEN_SINCE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        notify_email_changed(user, old_email)
        return Response(me_payload(user))


class AccountDeleteView(AccountView):
    """Deletes the account and, through the cascades, everything it owns."""

    def post(self, request):
        serializer = AccountDeleteSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
