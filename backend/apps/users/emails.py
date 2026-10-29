from django.core.mail import send_mail
from django.template.loader import render_to_string

SUBJECTS = {
    "verify": "Your StudyPilot verification code",
    "reset": "Your StudyPilot password reset code",
    "email": "Confirm your new StudyPilot email",
}
TEMPLATES = {
    "verify": "users/email/verify_code",
    "reset": "users/email/reset_code",
    "email": "users/email/email_change_code",
}
EXPIRY_MINUTES = 15
EMAIL_CHANGED_SUBJECT = "Your StudyPilot email was changed"
EMAIL_CHANGED_TEMPLATE = "users/email/email_changed"


def _send(subject: str, template: str, context: dict, to: str) -> None:
    send_mail(
        subject=subject,
        message=render_to_string(f"{template}.txt", context),
        from_email=None,
        recipient_list=[to],
        html_message=render_to_string(f"{template}.html", context),
        fail_silently=False,
    )


def send_code_email(to: str, username: str, purpose: str, code: str) -> None:
    """Send `code` to `to` as a plain-text email with an HTML alternative. Takes plain values only, so it can
    run on a background thread without touching the database."""
    context = {"username": username, "code": code, "expiry_minutes": EXPIRY_MINUTES}
    _send(SUBJECTS[purpose], TEMPLATES[purpose], context, to)


def send_email_changed_notice(to: str, username: str, new_email: str) -> None:
    """Tell the previous address `to` that the account's email is now `new_email`."""
    context = {"username": username, "new_email": new_email}
    _send(EMAIL_CHANGED_SUBJECT, EMAIL_CHANGED_TEMPLATE, context, to)
