from django.urls import path

from .views import (
    AccountDeleteView,
    EmailChangeConfirmView,
    EmailChangeRequestView,
    MeView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    ResendCodeView,
    VerifyEmailView,
)

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("me/password/", PasswordChangeView.as_view(), name="me-password"),
    path("me/email/", EmailChangeRequestView.as_view(), name="me-email"),
    path("me/email/confirm/", EmailChangeConfirmView.as_view(), name="me-email-confirm"),
    path("me/delete/", AccountDeleteView.as_view(), name="me-delete"),
    path("register/", RegisterView.as_view(), name="register"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("resend-code/", ResendCodeView.as_view(), name="resend-code"),
    path("password-reset/request/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
]
