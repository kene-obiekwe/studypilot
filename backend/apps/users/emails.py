from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.template.loader import render_to_string

SUBJECTS = {
    "verify": "Your StudyPilot verification code",
    "reset": "Your StudyPilot password reset code",
}
TEMPLATES = {
    "verify": "users/email/verify_code",
    "reset": "users/email/reset_code",
}
EXPIRY_MINUTES = 15


def send_code_email(user: User, purpose: str, code: str) -> None:
    """Send `code` to the user's address as a plain-text email with an HTML alternative."""
    context = {"username": user.username, "code": code, "expiry_minutes": EXPIRY_MINUTES}
    template = TEMPLATES[purpose]
    send_mail(
        subject=SUBJECTS[purpose],
        message=render_to_string(f"{template}.txt", context),
        from_email=None,
        recipient_list=[user.email],
        html_message=render_to_string(f"{template}.html", context),
        fail_silently=False,
    )
