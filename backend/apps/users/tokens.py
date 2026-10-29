"""Refresh-token revocation on top of SimpleJWT's blacklist app.

Only tokens issued since the blacklist app was installed have an outstanding row, so a token issued before
that is not revoked by `blacklist_user_tokens`; it expires with its refresh lifetime. Access tokens are never
checked against the blacklist and stay valid until they expire.
"""

from django.contrib.auth.models import User
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken


def blacklist_user_tokens(user: User) -> None:
    """Revoke every refresh token issued to `user` that is not revoked already."""
    live = OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True)
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token=token) for token in live], ignore_conflicts=True)


def issue_pair(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}
