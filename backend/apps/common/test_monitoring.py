import logging
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from .monitoring import before_send, init_sentry

DSN = "https://publickey@o0.ingest.sentry.io/0"


def full_event():
    return {
        "message": "boom",
        "request": {
            "url": "https://api.example.com/api/auth/token/?code=123456#frag",
            "method": "POST",
            "query_string": "code=123456",
            "data": {"password": "hunter2"},
            "cookies": {"sessionid": "abc"},
            "env": {"REMOTE_ADDR": "203.0.113.9"},
            "headers": {
                "Authorization": "Bearer secret",
                "cookie": "sessionid=abc",
                "X-Forwarded-For": "203.0.113.9",
                "Content-Type": "application/json",
            },
        },
        "user": {"id": 1, "email": "a@example.com", "username": "ada", "ip_address": "203.0.113.9"},
    }


class BeforeSendTests(SimpleTestCase):
    def test_request_and_user_fields_are_removed(self):
        event = before_send(full_event(), {})
        request = event["request"]
        self.assertNotIn("query_string", request)
        self.assertNotIn("data", request)
        self.assertNotIn("cookies", request)
        self.assertNotIn("env", request)
        self.assertNotIn("user", event)

    def test_sensitive_headers_are_removed_whatever_their_case(self):
        headers = before_send(full_event(), {})["request"]["headers"]
        self.assertEqual(headers, {"Content-Type": "application/json"})

    def test_header_pairs_are_filtered_too(self):
        event = full_event()
        event["request"]["headers"] = [["Authorization", "Bearer secret"], ["Accept", "*/*"]]
        self.assertEqual(before_send(event, {})["request"]["headers"], [["Accept", "*/*"]])

    def test_url_loses_query_string_and_fragment(self):
        self.assertEqual(before_send(full_event(), {})["request"]["url"], "https://api.example.com/api/auth/token/")

    def test_keeps_the_error_itself(self):
        event = before_send(full_event(), {})
        self.assertEqual(event["message"], "boom")
        self.assertEqual(event["request"]["method"], "POST")

    def test_event_without_a_request_passes(self):
        self.assertEqual(before_send({"message": "boom"}, {}), {"message": "boom"})


class InitSentryTests(SimpleTestCase):
    def init(self, **kwargs):
        with mock.patch("apps.common.monitoring.sentry_sdk.init") as init:
            init_sentry(DSN, **kwargs)
        init.assert_called_once()
        return init.call_args.kwargs

    def test_privacy_options(self):
        options = self.init(environment="production")
        self.assertEqual(options["dsn"], DSN)
        self.assertIs(options["send_default_pii"], False)
        self.assertEqual(options["max_request_body_size"], "never")
        self.assertIs(options["include_local_variables"], False)
        self.assertIs(options["before_send"], before_send)

    def test_errors_only_no_tracing_or_profiling(self):
        options = self.init(environment="production")
        self.assertEqual(options["traces_sample_rate"], 0.0)
        self.assertNotIn("profiles_sample_rate", options)
        self.assertNotIn("profiles_sampler", options)

    def test_trace_rate_environment_and_release_pass_through(self):
        options = self.init(environment="staging", release="abc123", traces_sample_rate=0.25)
        self.assertEqual(options["environment"], "staging")
        self.assertEqual(options["release"], "abc123")
        self.assertEqual(options["traces_sample_rate"], 0.25)

    def test_blank_release_is_none(self):
        self.assertIsNone(self.init(environment="production", release="")["release"])

    def test_integrations_log_events_at_error_only(self):
        integrations = self.init(environment="production")["integrations"]
        self.assertTrue(any(isinstance(item, DjangoIntegration) for item in integrations))
        logging_integration = next(item for item in integrations if isinstance(item, LoggingIntegration))
        self.assertEqual(logging_integration._handler.level, logging.ERROR)


class NothingStartsWithoutDsnTests(SimpleTestCase):
    def test_test_run_has_no_dsn(self):
        from django.conf import settings

        self.assertEqual(settings.SENTRY_DSN, "")


class SentryCheckCommandTests(SimpleTestCase):
    @override_settings(SENTRY_DSN="")
    def test_fails_without_a_dsn(self):
        out = StringIO()
        with mock.patch("apps.users.management.commands.sentry_check.init_sentry") as init:
            with self.assertRaises(CommandError):
                call_command("sentry_check", stdout=out)
        init.assert_not_called()
        self.assertIn("not set", out.getvalue())

    @override_settings(SENTRY_DSN=DSN)
    def test_sends_one_event_and_never_prints_the_dsn(self):
        out = StringIO()
        with (
            mock.patch("apps.users.management.commands.sentry_check.init_sentry") as init,
            mock.patch("apps.users.management.commands.sentry_check.sentry_sdk") as sdk,
        ):
            call_command("sentry_check", stdout=out)
        init.assert_called_once_with(DSN, environment="local-check")
        sdk.capture_message.assert_called_once()
        sdk.flush.assert_called_once()
        self.assertIn("is set", out.getvalue())
        self.assertNotIn("publickey", out.getvalue())
        self.assertNotIn("sentry.io", out.getvalue())
