"""Signing in with a username or an email address."""

from unittest import mock

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle

from .serializers import LOGIN_FAILED_MESSAGE
from .test_email_verification import PASSWORD, RESET_REQUEST, TOKEN, EmailFlowTestCase
from .verification import find_user_by_email, mark_verified, users_with_email


class LoginIdentifierTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.verified_user(username="Ada", email="Ada.Lovelace@Example.com")

    def assert_signed_in(self, response):
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_username_signs_in(self):
        self.assert_signed_in(self.post(TOKEN, identifier="Ada", password=PASSWORD))

    def test_email_signs_in(self):
        self.assert_signed_in(self.post(TOKEN, identifier="Ada.Lovelace@Example.com", password=PASSWORD))

    def test_email_matching_ignores_case_and_surrounding_spaces(self):
        self.assert_signed_in(self.post(TOKEN, identifier="  ada.lovelace@EXAMPLE.COM ", password=PASSWORD))

    def test_the_original_username_field_still_works_for_both_kinds_of_identifier(self):
        self.assert_signed_in(self.post(TOKEN, username="Ada", password=PASSWORD))
        self.assert_signed_in(self.post(TOKEN, username="ada.lovelace@example.com", password=PASSWORD))

    def test_the_username_itself_is_still_case_sensitive(self):
        self.assertEqual(self.post(TOKEN, identifier="ada", password=PASSWORD).status_code, 401)

    def test_a_username_that_contains_an_at_sign_still_works(self):
        self.verified_user(username="ada@home", email="other@example.com")
        self.assert_signed_in(self.post(TOKEN, identifier="ada@home", password=PASSWORD))

    def test_an_email_belonging_to_another_account_wins_over_a_look_alike_username(self):
        self.verified_user(username="ada.lovelace@example.com", email="someone.else@example.com", password="Other-Pass-7733")
        response = self.post(TOKEN, identifier="ada.lovelace@example.com", password=PASSWORD)
        self.assert_signed_in(response)
        self.assertEqual(self.post(TOKEN, identifier="ada.lovelace@example.com", password="Other-Pass-7733").status_code, 401)

    def test_an_identifier_is_required(self):
        response = self.post(TOKEN, password=PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertIn("identifier", response.data)
        self.assertEqual(self.post(TOKEN, identifier="   ", password=PASSWORD).status_code, 400)

    def test_an_unverified_account_gets_the_distinct_answer_by_email_too(self):
        self.register(username="newbie", email="newbie@example.com")
        by_email = self.post(TOKEN, identifier="newbie@example.com", password=PASSWORD)
        by_name = self.post(TOKEN, identifier="newbie", password=PASSWORD)
        for response in (by_email, by_name):
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["code"], "email_not_verified")
            self.assertNotIn("access", response.data)

    def test_an_unverified_account_with_a_wrong_password_is_not_revealed(self):
        self.register(username="newbie", email="newbie@example.com")
        response = self.post(TOKEN, identifier="newbie@example.com", password="wrong-wrong-1")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("code", response.data)


class GenericFailureTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.verified_user(username="ada", email="ada@example.com")

    def failures(self):
        return {
            "wrong password, username": self.post(TOKEN, identifier="ada", password="not-the-password"),
            "wrong password, email": self.post(TOKEN, identifier="ada@example.com", password="not-the-password"),
            "unknown username": self.post(TOKEN, identifier="nobody", password=PASSWORD),
            "unknown email": self.post(TOKEN, identifier="nobody@example.com", password=PASSWORD),
        }

    def test_every_failure_is_the_same_401_with_the_same_words(self):
        responses = self.failures()
        for label, response in responses.items():
            self.assertEqual(response.status_code, 401, label)
            self.assertEqual(response.data["detail"], LOGIN_FAILED_MESSAGE, label)
        self.assertEqual(len({str(response.data) for response in responses.values()}), 1)

    def test_the_words_do_not_say_which_part_was_wrong(self):
        text = self.failures()["wrong password, email"].data["detail"].lower()
        for word in ("password", "username", "email", "incorrect", "invalid"):
            self.assertNotIn(word, text)
        self.assertEqual(LOGIN_FAILED_MESSAGE, "No account found with those details.")


class DuplicateEmailTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.first = self.verified_user(username="first", email="shared@example.com")
        self.second = self.verified_user(username="second", email="Shared@Example.com")

    def test_signing_in_by_a_shared_email_fails_generically_even_with_the_right_password(self):
        response = self.post(TOKEN, identifier="shared@example.com", password=PASSWORD)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], LOGIN_FAILED_MESSAGE)
        unknown = self.post(TOKEN, identifier="unknown@example.com", password=PASSWORD)
        self.assertEqual(response.data, unknown.data)

    def test_both_accounts_can_still_sign_in_by_username(self):
        for username in ("first", "second"):
            self.assertEqual(self.post(TOKEN, identifier=username, password=PASSWORD).status_code, 200, username)

    def test_the_lookup_helpers(self):
        self.assertEqual([user.username for user in users_with_email(" SHARED@example.com ")], ["first", "second"])
        self.assertEqual(len(users_with_email("shared@example.com", 1)), 1)
        # The older helper, used by resend and reset, still picks the lowest id.
        self.assertEqual(find_user_by_email("shared@example.com"), self.first)
        self.assertIsNone(find_user_by_email("nobody@example.com"))


class LoginThrottleTests(EmailFlowTestCase):
    def test_signing_in_with_an_email_is_still_throttled(self):
        user = self.verified_user()
        patcher = mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/minute"})
        patcher.start()
        self.addCleanup(patcher.stop)
        cache.clear()
        for attempt in range(3):
            self.assertEqual(self.post(TOKEN, identifier=user.email, password="nope-nope-1").status_code, 401, attempt)
        response = self.post(TOKEN, identifier=user.email, password=PASSWORD)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)


class ResetEmailUsernameTests(EmailFlowTestCase):
    def test_the_reset_email_tells_the_user_their_username(self):
        user = self.verified_user(username="ada_l", email="ada@example.com")
        self.post(RESET_REQUEST, email=user.email)
        message = mail.outbox[0]
        line = "Your username is ada_l. You can also sign in with this email address."
        self.assertIn(line, message.body)
        html, _ = message.alternatives[0]
        self.assertIn(line, html)
        for content in (message.body, html):
            self.assertNotIn("http", content)
            self.assertNotIn(PASSWORD, content)

    def test_the_username_is_escaped_in_the_html_part(self):
        user = User.objects.create_user(username="a<b>c", email="angle@example.com", password=PASSWORD)
        mark_verified(user)
        self.post(RESET_REQUEST, email=user.email)
        html, _ = mail.outbox[0].alternatives[0]
        self.assertIn("a&lt;b&gt;c", html)
        self.assertNotIn("a<b>c", html)
