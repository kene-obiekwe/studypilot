import re
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from .models import EmailVerification, OneTimeCode
from .verification import MAX_ATTEMPTS, is_verified, mark_verified

REGISTER = "/api/users/register/"
VERIFY = "/api/users/verify-email/"
RESEND = "/api/users/resend-code/"
RESET_REQUEST = "/api/users/password-reset/request/"
RESET_CONFIRM = "/api/users/password-reset/confirm/"
TOKEN = "/api/auth/token/"

PASSWORD = "Quartz-Meadow-4471"
NEW_PASSWORD = "Granite-Harbour-9082"
EMAIL = "learner@example.com"
BAD_CODE_DETAIL = "That code is incorrect or has expired. Request a new one."


def last_code() -> str:
    match = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
    assert match, mail.outbox[-1].body
    return match.group(1)


def age_codes(user, seconds=120):
    """Make a user's codes look `seconds` old so the resend cooldown has passed."""
    OneTimeCode.objects.filter(user=user).update(created_at=timezone.now() - timedelta(seconds=seconds))


class EmailFlowTestCase(APITestCase):
    """Common setup: clean throttle counters and generous rate limits, except in the throttle tests."""

    email_rate = "1000/hour"

    def setUp(self):
        cache.clear()
        patcher = mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"email": self.email_rate, "auth": "1000/minute"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, url, **data):
        return self.client.post(url, data, format="json")

    def register(self, username="learner", email=EMAIL, password=PASSWORD):
        return self.post(REGISTER, username=username, email=email, password=password)

    def verified_user(self, username="verified", email="verified@example.com", password=PASSWORD):
        user = User.objects.create_user(username=username, email=email, password=password)
        mark_verified(user)
        return user


class RegisterVerifyTokenFlowTests(EmailFlowTestCase):
    def test_full_flow_register_verify_then_token(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data, {"status": "verification_required", "email": EMAIL})
        self.assertNotIn("password", response.data)

        user = User.objects.get(username="learner")
        self.assertFalse(is_verified(user))
        self.assertEqual(len(mail.outbox), 1)

        verified = self.post(VERIFY, email=EMAIL, code=last_code())
        self.assertEqual(verified.status_code, 200, verified.data)
        self.assertEqual(set(verified.data), {"access", "refresh"})
        user = User.objects.get(username="learner")
        self.assertTrue(is_verified(user))

        # The returned access token works, and so does a normal sign-in afterwards.
        me = self.client.get("/api/tracking/history/", HTTP_AUTHORIZATION=f"Bearer {verified.data['access']}")
        self.assertEqual(me.status_code, 200)
        signed_in = self.post(TOKEN, username="learner", password=PASSWORD)
        self.assertEqual(signed_in.status_code, 200)
        self.assertIn("access", signed_in.data)

    def test_email_matching_ignores_case(self):
        self.register()
        response = self.post(VERIFY, email=EMAIL.upper(), code=last_code())
        self.assertEqual(response.status_code, 200)

    def test_a_used_code_cannot_be_used_again(self):
        self.register()
        code = last_code()
        self.assertEqual(self.post(VERIFY, email=EMAIL, code=code).status_code, 200)
        again = self.post(VERIFY, email=EMAIL, code=code)
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data["detail"], BAD_CODE_DETAIL)


class UnverifiedLoginTests(EmailFlowTestCase):
    def test_correct_credentials_for_an_unverified_account_get_the_distinct_message(self):
        self.register()
        response = self.post(TOKEN, username="learner", password=PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Verify your email first.")
        self.assertEqual(response.data["code"], "email_not_verified")
        self.assertNotIn("access", response.data)

    def test_wrong_credentials_keep_the_generic_message(self):
        self.register()
        wrong_password = self.post(TOKEN, username="learner", password="not-the-password")
        unknown_user = self.post(TOKEN, username="nobody", password=PASSWORD)
        self.assertEqual(wrong_password.status_code, 401)
        self.assertEqual(unknown_user.status_code, 401)
        self.assertEqual(wrong_password.data, unknown_user.data)
        self.assertNotIn("Verify", str(wrong_password.data))

    def test_a_user_with_no_verification_record_is_unverified(self):
        User.objects.create_user(username="plain", password=PASSWORD)
        response = self.post(TOKEN, username="plain", password=PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "email_not_verified")


class CodeRulesTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.register()
        self.user = User.objects.get(username="learner")
        self.code = last_code()

    def wrong_code(self):
        return "000000" if self.code != "000000" else "111111"

    def test_wrong_code_is_rejected_and_the_right_one_still_works(self):
        response = self.post(VERIFY, email=EMAIL, code=self.wrong_code())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)
        self.assertFalse(is_verified(User.objects.get(pk=self.user.pk)))
        self.assertEqual(self.post(VERIFY, email=EMAIL, code=self.code).status_code, 200)

    def test_expired_code_is_rejected(self):
        OneTimeCode.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.post(VERIFY, email=EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)

    def test_code_lives_for_15_minutes(self):
        record = OneTimeCode.objects.get(user=self.user)
        lifetime = record.expires_at - record.created_at
        self.assertGreater(lifetime, timedelta(minutes=14, seconds=55))
        self.assertLess(lifetime, timedelta(minutes=15, seconds=5))

    def test_five_wrong_attempts_kill_the_code(self):
        for _ in range(MAX_ATTEMPTS):
            self.assertEqual(self.post(VERIFY, email=EMAIL, code=self.wrong_code()).status_code, 400)
        response = self.post(VERIFY, email=EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)
        self.assertEqual(OneTimeCode.objects.get(user=self.user).attempts, MAX_ATTEMPTS)
        self.assertFalse(is_verified(User.objects.get(pk=self.user.pk)))

    def test_the_right_code_on_the_fifth_attempt_still_works(self):
        for _ in range(MAX_ATTEMPTS - 1):
            self.post(VERIFY, email=EMAIL, code=self.wrong_code())
        self.assertEqual(self.post(VERIFY, email=EMAIL, code=self.code).status_code, 200)

    def test_a_dead_code_is_replaced_by_requesting_a_new_one(self):
        for _ in range(MAX_ATTEMPTS):
            self.post(VERIFY, email=EMAIL, code=self.wrong_code())
        age_codes(self.user)
        self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.post(VERIFY, email=EMAIL, code=last_code()).status_code, 200)

    def test_codes_must_be_six_digits(self):
        for code in ("12345", "1234567", "abcdef", "12 456", ""):
            with self.subTest(code=code):
                response = self.post(VERIFY, email=EMAIL, code=code)
                self.assertEqual(response.status_code, 400)
                self.assertIn("code", response.data)

    def test_codes_are_six_digits_from_the_email(self):
        self.assertRegex(self.code, r"^\d{6}$")

    def test_only_a_hash_of_the_code_is_stored(self):
        record = OneTimeCode.objects.get(user=self.user)
        self.assertNotEqual(record.code_hash, self.code)
        self.assertTrue(check_password(self.code, record.code_hash))
        stored = " ".join(str(value) for value in OneTimeCode.objects.filter(pk=record.pk).values()[0].values())
        self.assertNotIn(self.code, stored)

    def test_a_new_code_invalidates_the_old_one(self):
        age_codes(self.user)
        with mock.patch("apps.users.verification.generate_code", return_value="222222"):
            self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(OneTimeCode.objects.filter(user=self.user).count(), 1)
        if self.code != "222222":
            old = self.post(VERIFY, email=EMAIL, code=self.code)
            self.assertEqual(old.status_code, 400)
        self.assertEqual(self.post(VERIFY, email=EMAIL, code="222222").status_code, 200)

    def test_verification_of_an_already_verified_account_is_refused(self):
        mark_verified(self.user)
        response = self.post(VERIFY, email=EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)

    def test_unknown_email_gets_the_same_answer_as_a_wrong_code(self):
        unknown = self.post(VERIFY, email="nobody@example.com", code="123456")
        wrong = self.post(VERIFY, email=EMAIL, code=self.wrong_code())
        self.assertEqual(unknown.status_code, wrong.status_code)
        self.assertEqual(unknown.data, wrong.data)


class ResendCooldownTests(EmailFlowTestCase):
    def test_resend_inside_the_cooldown_sends_nothing(self):
        self.register()
        response = self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_resend_after_the_cooldown_sends_a_new_code(self):
        self.register()
        age_codes(User.objects.get(username="learner"), seconds=61)
        self.assertEqual(self.post(RESEND, email=EMAIL, purpose="verify").status_code, 200)
        self.assertEqual(len(mail.outbox), 2)

    def test_cooldown_is_60_seconds(self):
        self.register()
        user = User.objects.get(username="learner")
        age_codes(user, seconds=59)
        self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(len(mail.outbox), 1)
        age_codes(user, seconds=61)
        self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(len(mail.outbox), 2)

    def test_verify_and_reset_cooldowns_are_separate(self):
        user = self.verified_user()
        self.assertEqual(self.post(RESET_REQUEST, email=user.email).status_code, 200)
        self.assertEqual(self.post(RESET_REQUEST, email=user.email).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_resend_only_accepts_the_verify_purpose(self):
        self.register()
        for purpose in ("reset", "other", ""):
            with self.subTest(purpose=purpose):
                self.assertEqual(self.post(RESEND, email=EMAIL, purpose=purpose).status_code, 400)
        self.assertEqual(self.post(RESEND, email=EMAIL).status_code, 400)


class NoEnumerationTests(EmailFlowTestCase):
    def test_resend_answers_identically_for_every_kind_of_email(self):
        self.register()  # unverified
        self.verified_user()  # verified
        answers = [
            self.post(RESEND, email=email, purpose="verify")
            for email in (EMAIL, "verified@example.com", "nobody@example.com")
        ]
        self.assertEqual({r.status_code for r in answers}, {200})
        self.assertEqual(len({str(r.data) for r in answers}), 1)

    def test_resend_sends_only_to_an_existing_unverified_account(self):
        self.register()
        self.verified_user()
        sent_before = len(mail.outbox)
        age_codes(User.objects.get(username="learner"))
        self.post(RESEND, email="verified@example.com", purpose="verify")
        self.post(RESEND, email="nobody@example.com", purpose="verify")
        self.assertEqual(len(mail.outbox), sent_before)
        self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(len(mail.outbox), sent_before + 1)

    def test_reset_request_answers_identically_for_every_kind_of_email(self):
        self.register()  # unverified
        self.verified_user()  # verified
        answers = [
            self.post(RESET_REQUEST, email=email) for email in (EMAIL, "verified@example.com", "nobody@example.com")
        ]
        self.assertEqual({r.status_code for r in answers}, {200})
        self.assertEqual(len({str(r.data) for r in answers}), 1)

    def test_reset_request_sends_only_to_a_verified_account(self):
        self.register()
        sent_before = len(mail.outbox)
        self.post(RESET_REQUEST, email=EMAIL)  # unverified
        self.post(RESET_REQUEST, email="nobody@example.com")
        self.assertEqual(len(mail.outbox), sent_before)
        self.verified_user()
        self.post(RESET_REQUEST, email="verified@example.com")
        self.assertEqual(len(mail.outbox), sent_before + 1)
        self.assertEqual(mail.outbox[-1].to, ["verified@example.com"])

    def test_reset_confirm_answers_identically_for_unknown_and_wrong_code(self):
        self.verified_user()
        self.post(RESET_REQUEST, email="verified@example.com")
        wrong = self.post(RESET_CONFIRM, email="verified@example.com", code="000001", new_password=NEW_PASSWORD)
        unknown = self.post(RESET_CONFIRM, email="nobody@example.com", code="000001", new_password=NEW_PASSWORD)
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.status_code, unknown.status_code)
        self.assertEqual(wrong.data, unknown.data)

    def test_a_weak_password_does_not_reveal_whether_the_account_exists(self):
        unknown = self.post(RESET_CONFIRM, email="nobody@example.com", code="123456", new_password="password123")
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(unknown.data["detail"], BAD_CODE_DETAIL)
        self.assertNotIn("new_password", unknown.data)


class PasswordResetTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.verified_user()
        self.post(RESET_REQUEST, email=self.user.email)
        self.code = last_code()

    def confirm(self, **overrides):
        data = {"email": self.user.email, "code": self.code, "new_password": NEW_PASSWORD}
        data.update(overrides)
        return self.post(RESET_CONFIRM, **data)

    def test_reset_sets_the_password_and_invalidates_every_code(self):
        OneTimeCode.objects.create(
            user=self.user, purpose="verify", code_hash="x", expires_at=timezone.now() + timedelta(minutes=5)
        )
        response = self.confirm()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(OneTimeCode.objects.filter(user=self.user).count(), 0)
        self.assertEqual(self.post(TOKEN, username="verified", password=NEW_PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, username="verified", password=PASSWORD).status_code, 401)

    def test_the_code_cannot_be_used_twice(self):
        self.assertEqual(self.confirm().status_code, 200)
        again = self.confirm(new_password="Another-Strong-Pass-1357")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data["detail"], BAD_CODE_DETAIL)

    def test_password_validators_apply_and_leave_the_code_usable(self):
        weak = (
            ("password123", "common"),
            ("8274619305", "entirely numeric"),
            ("verified99", "too similar"),
            ("short1!", "at least 8"),
        )
        for password, fragment in weak:
            with self.subTest(password=password):
                response = self.confirm(new_password=password)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(any(fragment in message for message in response.data["new_password"]), response.data)
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password(PASSWORD))
        self.assertEqual(self.confirm().status_code, 200)

    def test_wrong_code_does_not_change_the_password(self):
        wrong = "000000" if self.code != "000000" else "111111"
        self.assertEqual(self.confirm(code=wrong).status_code, 400)
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password(PASSWORD))

    def test_five_wrong_attempts_kill_the_reset_code(self):
        wrong = "000000" if self.code != "000000" else "111111"
        for _ in range(MAX_ATTEMPTS):
            self.confirm(code=wrong)
        self.assertEqual(self.confirm().status_code, 400)

    def test_expired_reset_code_is_rejected(self):
        OneTimeCode.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.confirm().status_code, 400)

    def test_a_verify_code_cannot_reset_a_password(self):
        OneTimeCode.objects.filter(user=self.user).delete()
        with mock.patch("apps.users.verification.generate_code", return_value="654321"):
            mark = OneTimeCode.Purpose.VERIFY
            from .verification import issue_code

            issue_code(self.user, mark)
        self.assertEqual(self.confirm(code="654321").status_code, 400)

    def test_an_unverified_account_cannot_reset(self):
        self.register(username="pending", email="pending@example.com")
        pending = User.objects.get(username="pending")
        OneTimeCode.objects.filter(user=pending).delete()
        with mock.patch("apps.users.verification.generate_code", return_value="135790"):
            from .verification import issue_code

            issue_code(pending, OneTimeCode.Purpose.RESET)
        response = self.post(RESET_CONFIRM, email="pending@example.com", code="135790", new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 400)


class RegisterEdgeCaseTests(EmailFlowTestCase):
    def test_duplicate_verified_email_is_rejected(self):
        self.verified_user(email=EMAIL)
        response = self.register(username="someoneelse")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_unverified_email_with_a_different_username_is_rejected(self):
        self.register()
        response = self.register(username="another")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)
        self.assertFalse(User.objects.filter(username="another").exists())
        self.assertEqual(len(mail.outbox), 1)

    def test_retrying_an_unverified_account_resends_a_code_and_updates_the_password(self):
        self.register()
        age_codes(User.objects.get(username="learner"))
        response = self.register(password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data, {"status": "verification_required", "email": EMAIL})
        self.assertEqual(User.objects.filter(email=EMAIL).count(), 1)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.post(VERIFY, email=EMAIL, code=last_code()).status_code, 200)
        self.assertEqual(self.post(TOKEN, username="learner", password=NEW_PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, username="learner", password=PASSWORD).status_code, 401)

    def test_retrying_inside_the_cooldown_still_answers_but_sends_nothing(self):
        self.register()
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(len(mail.outbox), 1)

    def test_a_retry_must_still_pass_the_password_validators(self):
        self.register()
        response = self.register(password="password123")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)

    def test_a_taken_username_with_another_email_is_rejected(self):
        self.verified_user(username="taken", email="taken@example.com")
        response = self.register(username="taken", email="new@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_a_failed_send_does_not_fail_registration_or_log_the_code(self):
        with mock.patch("apps.users.emails.send_mail", side_effect=OSError("smtp down")), mock.patch(
            "apps.users.verification.generate_code", return_value="424242"
        ):
            with self.assertLogs("apps.users.verification", level="WARNING") as logs:
                response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(mail.outbox), 0)
        self.assertNotIn("424242", "\n".join(logs.output))
        self.assertTrue(OneTimeCode.objects.filter(user__username="learner").exists())

    def test_a_failed_send_does_not_fail_a_reset_request(self):
        user = self.verified_user()
        with mock.patch("apps.users.emails.send_mail", side_effect=OSError("smtp down")):
            with self.assertLogs("apps.users.verification", level="WARNING"):
                response = self.post(RESET_REQUEST, email=user.email)
        self.assertEqual(response.status_code, 200)


class EmailContentTests(EmailFlowTestCase):
    def test_verification_email_has_the_code_and_nothing_secret(self):
        self.register()
        message = mail.outbox[0]
        code = last_code()
        self.assertEqual(message.subject, "Your StudyPilot verification code")
        self.assertEqual(message.to, [EMAIL])
        self.assertEqual(message.from_email, settings.DEFAULT_FROM_EMAIL)
        self.assertIn(code, message.body)
        self.assertIn("15 minutes", message.body)
        self.assertIn("ignore this email", message.body)
        html, mimetype = message.alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn(code, html)
        self.assertIn("15 minutes", html)
        self.assertIn("ignore this email", html)
        for content in (message.body, html, message.subject):
            self.assertNotIn(PASSWORD, content)
            self.assertNotIn(settings.SECRET_KEY, content)
            self.assertNotIn("<img", content)
            self.assertNotIn("http", content)
        self.assertFalse(message.extra_headers.get("Authorization"))

    def test_reset_email_has_the_code_and_the_right_subject(self):
        user = self.verified_user()
        self.post(RESET_REQUEST, email=user.email)
        message = mail.outbox[0]
        code = last_code()
        self.assertEqual(message.subject, "Your StudyPilot password reset code")
        self.assertIn(code, message.body)
        self.assertIn("15 minutes", message.body)
        self.assertIn("ignore this email", message.body)
        html, _ = message.alternatives[0]
        self.assertIn(code, html)
        self.assertNotIn("<img", html)
        self.assertNotIn(PASSWORD, message.body + html)


class EmailThrottleTests(EmailFlowTestCase):
    """The "email" scope: 5 requests per hour per client by default."""

    email_rate = "5/hour"

    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"email": "5/hour"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_throttled_on_the_sixth(self, url, **payload):
        cache.clear()
        for attempt in range(5):
            self.assertNotEqual(self.post(url, **payload).status_code, 429, f"request {attempt + 1}")
        response = self.post(url, **payload)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)

    def test_each_email_endpoint_is_throttled(self):
        self.assert_throttled_on_the_sixth(VERIFY, email=EMAIL, code="123456")
        self.assert_throttled_on_the_sixth(RESEND, email=EMAIL, purpose="verify")
        self.assert_throttled_on_the_sixth(RESET_REQUEST, email=EMAIL)
        self.assert_throttled_on_the_sixth(RESET_CONFIRM, email=EMAIL, code="123456", new_password=NEW_PASSWORD)

    def test_register_is_throttled_by_the_email_scope_too(self):
        self.assert_throttled_on_the_sixth(REGISTER)

    def test_the_email_bucket_is_separate_from_the_auth_bucket(self):
        cache.clear()
        for _ in range(5):
            self.post(RESEND, email=EMAIL, purpose="verify")
        self.assertEqual(self.post(RESEND, email=EMAIL, purpose="verify").status_code, 429)
        # Sign-in uses only the auth bucket, which is untouched.
        self.assertEqual(self.post(TOKEN, username="nobody", password="x").status_code, 401)


class PilotUsersVerifiedTests(TestCase):
    @override_settings(DEBUG=True)
    def test_the_seeder_marks_pilot_users_verified_and_they_can_sign_in(self):
        with mock.patch.dict("os.environ", {"PILOT_PASSWORD": NEW_PASSWORD}):
            call_command("seed_pilot_data", stdout=mock.MagicMock())
        pilots = User.objects.filter(username__startswith="pilot_")
        self.assertEqual(pilots.count(), 5)
        for user in pilots:
            self.assertTrue(is_verified(user), user.username)
        cache.clear()
        response = self.client.post(TOKEN, {"username": "pilot_consistent", "password": NEW_PASSWORD})
        self.assertEqual(response.status_code, 200)


BEFORE = [("users", "0001_initial")]
AFTER = [("users", "0002_mark_existing_users_verified")]


class ExistingUsersMigratedAsVerifiedTests(TransactionTestCase):
    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        old_apps = executor.loader.project_state(BEFORE).apps
        User = old_apps.get_model("auth", "User")
        self.user_ids = [User.objects.create(username=f"legacy{i}", email=f"legacy{i}@example.com").id for i in range(3)]
        old_apps.get_model("users", "EmailVerification").objects.create(user_id=self.user_ids[0])  # row, no timestamp

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_every_existing_user_is_verified_after_the_migration(self):
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        EmailVerification = executor.loader.project_state(AFTER).apps.get_model("users", "EmailVerification")
        for user_id in self.user_ids:
            record = EmailVerification.objects.get(user_id=user_id)
            self.assertIsNotNone(record.email_verified_at, user_id)
        self.assertEqual(EmailVerification.objects.count(), 3)

    def test_users_created_after_the_migration_start_unverified(self):
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        late = User.objects.create_user(username="late", password=PASSWORD)
        self.assertFalse(is_verified(User.objects.get(pk=late.pk)))
        self.assertFalse(EmailVerification.objects.filter(user=late).exists())
