"""Error tracking with Sentry, errors only.

Nothing here runs unless SENTRY_DSN is set (settings.py calls init_sentry only then). The privacy rule is
that an event carries the error and its stack, never personal data: no request bodies, cookies, Authorization
headers, user details, IP addresses, query strings or local variables, and no tracing, profiling or replay.
The SDK options below already switch these off; before_send strips them again as a backstop.
"""

from __future__ import annotations

import logging

import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

# Compared in lower case.
STRIPPED_HEADERS = frozenset({"authorization", "cookie", "x-forwarded-for", "x-real-ip"})
# Request fields that can hold personal data (the "env" block carries REMOTE_ADDR).
STRIPPED_REQUEST_FIELDS = ("query_string", "data", "cookies", "env")


def _is_stripped_header(name) -> bool:
    return str(name).lower() in STRIPPED_HEADERS


def before_send(event, hint):
    """Remove personal data from an event before it leaves the server. Never drops the event."""
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {name: value for name, value in headers.items() if not _is_stripped_header(name)}
        elif isinstance(headers, list):
            request["headers"] = [
                pair for pair in headers if not (isinstance(pair, (list, tuple)) and pair and _is_stripped_header(pair[0]))
            ]
        for field in STRIPPED_REQUEST_FIELDS:
            request.pop(field, None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = url.split("?", 1)[0].split("#", 1)[0]
    event.pop("user", None)
    return event


def init_sentry(dsn: str, *, environment: str, release: str | None = None, traces_sample_rate: float = 0.0) -> None:
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release or None,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        traces_sample_rate=traces_sample_rate,
        # Django's integration and logging at ERROR only: a warning such as an AI-plan fallback stays a log line.
        # level=None also keeps log lines out of the breadcrumbs, which could carry names or addresses.
        integrations=[DjangoIntegration(), LoggingIntegration(level=None, event_level=logging.ERROR)],
        before_send=before_send,
    )
