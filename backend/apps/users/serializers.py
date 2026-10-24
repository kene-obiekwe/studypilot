from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import EmailVerification
from .verification import CODE_LENGTH, find_user_by_email, is_verified

EMAIL_NOT_VERIFIED_CODE = "email_not_verified"
EMAIL_NOT_VERIFIED_MESSAGE = "Verify your email first."


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
            # An unverified account may re-register with the same username to get a new code.
            if is_verified(by_email) or by_email.username != username:
                raise serializers.ValidationError({"email": ["Email is already registered."]})
            self.resend_user = by_email
            candidate = by_email
        else:
            if User.objects.filter(username=username).exists():
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
    """Issues tokens only to accounts that have verified their email.

    Wrong credentials still fail with SimpleJWT's generic 401. The distinct response is only
    returned once the username and password are right.
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        if not is_verified(self.user):
            raise EmailNotVerified({"detail": EMAIL_NOT_VERIFIED_MESSAGE, "code": EMAIL_NOT_VERIFIED_CODE})
        return data
