from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import OneTimeCode
from .serializers import (
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendCodeSerializer,
    VerifiedTokenObtainPairSerializer,
    VerifyEmailSerializer,
    password_errors,
)
from .verification import (
    check_code,
    consume,
    find_user_by_email,
    invalidate_all_codes,
    is_verified,
    mark_verified,
    send_code,
)

BAD_CODE_MESSAGE = "That code is incorrect or has expired. Request a new one."
RESEND_MESSAGE = "If that email belongs to an account that needs a code, we have sent one."
RESET_REQUEST_MESSAGE = "If that email belongs to an account, we have sent a password reset code."
RESET_DONE_MESSAGE = "Your password has been reset. You can sign in now."


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
            user = serializer.save()
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
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


class ResendCodeView(EmailThrottledView):
    def post(self, request):
        serializer = ResendCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        if user is not None and not is_verified(user):
            send_code(user, OneTimeCode.Purpose.VERIFY)
        return Response({"detail": RESEND_MESSAGE})


class PasswordResetRequestView(EmailThrottledView):
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        if user is not None and user.is_active and is_verified(user):
            send_code(user, OneTimeCode.Purpose.RESET)
        return Response({"detail": RESET_REQUEST_MESSAGE})


class PasswordResetConfirmView(EmailThrottledView):
    """Sets a new password when the emailed code is right.

    The code is checked first, so a wrong email or code gives the same answer whether or not the
    account exists. A weak password leaves the code usable. Existing refresh tokens stay valid until
    they expire: the project has no token blacklist.
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
        return Response({"detail": RESET_DONE_MESSAGE})


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = VerifiedTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"
