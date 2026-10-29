from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import APIException, AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import EmailVerification
from .verification import CODE_LENGTH, find_user_by_email, is_verified, users_with_email

EMAIL_NOT_VERIFIED_CODE = "email_not_verified"
EMAIL_NOT_VERIFIED_MESSAGE = "Verify your email first."
LOGIN_FAILED_MESSAGE = "Incorrect username, email or password."


def password_errors(password: str, user: User) -> list[str]:
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        return list(exc.messages)
    return []


class RegisterSerializer(serializers.Serializer):
    """Validates a registration. `resend_user` is set when it is a retry for an unverified account."""

    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)

    resend_user: User | None = None

    def validate(self, attrs):
        username, email, password = attrs["username"], attrs["email"], attrs["password"]
        by_email = find_user_by_email(email)
        if by_email is not None:
            # An unverified account may re-register with the same username (ignoring case) to get a new code.
            if is_verified(by_email) or by_email.username.casefold() != username.casefold():
                raise serializers.ValidationError({"email": ["Email is already registered."]})
            self.resend_user = by_email
            candidate = by_email
        else:
            if User.objects.filter(username__iexact=username).exists():
                raise serializers.ValidationError({"username": ["A user with that username already exists."]})
            candidate = User(username=username, email=email)
        problems = password_errors(password, candidate)
        if problems:
            raise serializers.ValidationError({"password": problems})
        return attrs

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        EmailVerification.objects.create(user=user)
        return user


class CodeField(serializers.RegexField):
    def __init__(self, **kwargs):
        super().__init__(regex=rf"^\d{{{CODE_LENGTH}}}$", error_messages={"invalid": "Enter the 6-digit code."}, **kwargs)


class VerifyEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = CodeField()


class ResendCodeSerializer(serializers.Serializer):
    email = serializers.EmailField()
    purpose = serializers.ChoiceField(choices=["verify"])


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = CodeField()
    new_password = serializers.CharField(write_only=True)


class EmailNotVerified(APIException):
    status_code = 400
    default_detail = EMAIL_NOT_VERIFIED_MESSAGE
    default_code = EMAIL_NOT_VERIFIED_CODE


class VerifiedTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Signs in with a username or an email address, and only for accounts that verified their email.

    The one identifier arrives as `identifier` (or as `username`, the original name). When it contains
    "@" it is looked up by email, ignoring case; if that finds no account it is tried as a username,
    since usernames may contain "@". Two accounts sharing an address is never guessed between: that
    fails like any other wrong login. A username matches exactly first; failing that, a single account
    whose username differs only by case is used, and several such accounts fail the same way. Every
    failure, whichever part was wrong, is the same 401, and the distinct "verify your email" answer is
    only given once the identifier and password are right.
    """

    default_error_messages = {"no_active_account": LOGIN_FAILED_MESSAGE}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields[self.username_field].required = False
        self.fields["identifier"] = serializers.CharField(required=False, write_only=True)

    def _fail(self, password: str):
        # Hash anyway, so a rejected identifier takes as long as a wrong password.
        User().set_password(password)
        raise AuthenticationFailed(self.error_messages["no_active_account"], "no_active_account")

    def _resolve_username(self, identifier: str, password: str) -> str:
        """The exact username if it exists, else the one account that matches ignoring case."""
        if User.objects.filter(username=identifier).exists():
            return identifier
        matches = list(User.objects.filter(username__iexact=identifier).values_list("username", flat=True)[:2])
        if len(matches) > 1:
            self._fail(password)
        return matches[0] if matches else identifier

    def validate(self, attrs):
        identifier = (attrs.get("identifier") or attrs.get(self.username_field) or "").strip()
        password = attrs.get("password", "")
        if not identifier:
            raise serializers.ValidationError({"identifier": ["Enter your username or email."]})
        matches = users_with_email(identifier, 2) if "@" in identifier else []
        if len(matches) > 1:
            self._fail(password)
        identifier = matches[0].username if matches else self._resolve_username(identifier, password)
        data = super().validate({self.username_field: identifier, "password": password})
        if not is_verified(self.user):
            raise EmailNotVerified({"detail": EMAIL_NOT_VERIFIED_MESSAGE, "code": EMAIL_NOT_VERIFIED_CODE})
        return data
