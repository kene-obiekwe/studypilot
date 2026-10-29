"""Guarded access to the optional language model used for study plans and trait suggestions.

Everything here fails closed: any timeout, API error, refusal, truncation or malformed answer
raises AIError with a short reason, and callers serve their rules-based result instead. The
API key is read from the environment by the SDK itself and never passes through this code.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache

import anthropic
from django.conf import settings
from rest_framework.throttling import UserRateThrottle

logger = logging.getLogger(__name__)


class AIError(Exception):
    """The model's answer can't be used. `reason` is safe to log: it never holds request data."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AIResult:
    data: dict
    model: str
    input_tokens: int
    output_tokens: int


def ai_enabled() -> bool:
    return bool(settings.AI_PLAN_ENABLED)


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=settings.AI_PLAN_TIMEOUT_SECONDS, max_retries=1)


def call_structured(*, system: str, content: str, schema: dict, max_tokens: int) -> AIResult:
    """One structured-output request at low effort; returns the parsed JSON object."""
    try:
        response = get_client().messages.create(
            model=settings.AI_PLAN_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        )
    # `from None` keeps SDK request details out of tracebacks and logs.
    except anthropic.APITimeoutError:
        raise AIError("timeout") from None
    except anthropic.APIConnectionError:
        raise AIError("connection_error") from None
    except anthropic.RateLimitError:
        raise AIError("rate_limited") from None
    except anthropic.APIStatusError as exc:
        raise AIError(f"api_error_{exc.status_code}") from None
    except anthropic.APIError:
        raise AIError("api_error") from None

    if response.stop_reason == "refusal":
        raise AIError("refusal")
    if response.stop_reason != "end_turn":
        raise AIError(f"stop_{response.stop_reason}")
    text = next((block.text for block in response.content if block.type == "text"), None)
    if text is None:
        raise AIError("no_text")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise AIError("malformed_json") from None
    if not isinstance(data, dict):
        raise AIError("malformed_json")
    usage = response.usage
    return AIResult(data, str(response.model), int(usage.input_tokens or 0), int(usage.output_tokens or 0))


class AICallThrottle(UserRateThrottle):
    """Per-user daily budget of model calls, shared by plans and trait suggestions.

    Checked by hand right before a call would be made, so cache hits and rules-only responses
    never count. Counts live in Django's cache: shared (database-backed) in production,
    per-process memory in development and tests.
    """

    scope = "ai_plan"

    def get_rate(self) -> str:
        return f"{settings.AI_PLAN_DAILY_LIMIT}/day"


def allow_ai_call(request) -> bool:
    return AICallThrottle().allow_request(request, None)


def log_fallback(purpose: str, error: AIError) -> None:
    logger.warning("AI %s unavailable, serving the rules-based result (%s)", purpose, error.reason)
