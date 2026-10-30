"""The signed-in account endpoints: change username, password and email, and delete the account."""

from datetime import date, timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.throttling import ScopedRateThrottle

from apps.planner.models import Course, StudyPlan
from apps.recommendations.models import GeneratedPlan, ShownStrategy, StrategyFeedback
from apps.tracking.models import StudySessionLog

from .models import EmailVerification, OneTimeCode
from .serializers import (
    DELETE_CONFIRM_MESSAGE,
    EMAIL_IN_USE_MESSAGE,
    SAME_EMAIL_MESSAGE,
    USERNAME_TAKEN_MESSAGE,
    WRONG_PASSWORD_MESSAGE,
)
from .test_email_verification import (
    BAD_CODE_DETAIL,
    NEW_PASSWORD,
    PASSWORD,
    TOKEN,
    EmailFlowTestCase,
    age_codes,
    last_code,
)
from .verification import MAX_ATTEMPTS, is_verified

ME = "/api/users/me/"
CHANGE_PASSWORD = "/api/users/me/password/"
CHANGE_EMAIL = "/api/users/me/email/"
CONFIRM_EMAIL = "/api/users/me/email/confirm/"
DELETE = "/api/users/me/delete/"

OLD_EMAIL = "kene@example.com"
NEW_EMAIL = "kene.new@example.com"


class AccountTestCase(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.verified_user(username="kene", email=OLD_EMAIL)
        self.other = self.verified_user(username="Other", email="other@example.com")
        self.client.force_authenticate(self.user)

    def patch(self, url, **data):
        return self.client.patch(url, data, format="json")

    def reload(self):
        self.user.refresh_from_db()
        return self.user

    def request_change(self, new_email=NEW_EMAIL, password=PASSWORD):
        return self.post(CHANGE_EMAIL, password=password, new_email=new_email)

    def wrong(self, code):
        return "000000" if code != "000000" else "111111"


class UnauthenticatedTests(AccountTestCase):
    def test_every_account_endpoint_requires_sign_in(self):
        self.client.force_authenticate(None)
        calls = [
            ("patch", ME, {"username": "x"}),
            ("post", CHANGE_PASSWORD, {"current_password": PASSWORD, "new_password": NEW_PASSWORD}),
            ("post", CHANGE_EMAIL, {"password": PASSWORD, "new_email": NEW_EMAIL}),
            ("post", CONFIRM_EMAIL, {"code": "123456"}),
            ("post", DELETE, {"password": PASSWORD, "confirm": "DELETE"}),
        ]
        for method, url, data in calls:
            with self.subTest(url=url):
                self.assertEqual(getattr(self.client, method)(url, data, format="json").status_code, 401)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())


class UsernameChangeTests(AccountTestCase):
    def test_changes_the_username_and_returns_the_me_payload(self):
        response = self.patch(ME, username="kene_o")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data,
            {"id": self.user.id, "username": "kene_o", "email": OLD_EMAIL, "time_zone": None, "time_zone_auto": True},
        )
        self.assertEqual(self.reload().username, "kene_o")

    def test_changing_only_the_case_of_your_own_name_is_allowed(self):
        response = self.patch(ME, username="Kene")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.reload().username, "Kene")

    def test_a_name_taken_by_another_account_in_another_case_is_rejected(self):
        response = self.patch(ME, username="OTHER")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["username"], [USERNAME_TAKEN_MESSAGE])
        self.assertEqual(self.reload().username, "kene")

    def test_the_registration_rules_apply(self):
        for name in ("has space", "bad!char", "x" * 151, ""):
            with self.subTest(name=name):
                response = self.patch(ME, username=name)
                self.assertEqual(response.status_code, 400)
                self.assertIn("username", response.data)
        self.assertEqual(self.reload().username, "kene")

    def test_the_new_name_signs_in(self):
        self.patch(ME, username="kene_o")
        self.client.force_authenticate(None)
        self.assertEqual(self.post(TOKEN, identifier="kene_o", password=PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=PASSWORD).status_code, 401)


class PasswordChangeTests(AccountTestCase):
    def test_changes_the_password(self):
        response = self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["detail"], "Your password has been changed.")
        self.assertTrue(self.reload().check_password(NEW_PASSWORD))
        self.client.force_authenticate(None)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=NEW_PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=PASSWORD).status_code, 401)

    def test_a_wrong_current_password_is_a_field_error(self):
        response = self.post(CHANGE_PASSWORD, current_password="not-it-at-all", new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"current_password": [WRONG_PASSWORD_MESSAGE]})
        self.assertTrue(self.reload().check_password(PASSWORD))

    def test_the_new_password_runs_the_validators_with_the_user(self):
        for weak in ("short1", "12345678901", "password123", "kene@example.co"):
            with self.subTest(weak=weak):
                response = self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=weak)
                self.assertEqual(response.status_code, 400)
                self.assertIn("new_password", response.data)
        self.assertTrue(self.reload().check_password(PASSWORD))

    def test_an_outstanding_reset_code_dies_with_the_old_password(self):
        self.client.force_authenticate(None)
        self.post("/api/users/password-reset/request/", email=OLD_EMAIL)
        self.assertTrue(OneTimeCode.objects.filter(user=self.user, purpose="reset").exists())
        self.client.force_authenticate(self.user)
        self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.assertFalse(OneTimeCode.objects.filter(user=self.user, purpose="reset").exists())


class EmailChangeRequestTests(AccountTestCase):
    def test_sends_a_code_to_the_new_address_and_changes_nothing_yet(self):
        response = self.request_change()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["email"], NEW_EMAIL)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [NEW_EMAIL])
        self.assertEqual(mail.outbox[0].subject, "Confirm your new StudyPilot email")
        self.assertRegex(last_code(), r"^\d{6}$")
        self.assertEqual(self.reload().email, OLD_EMAIL)
        record = OneTimeCode.objects.get(user=self.user, purpose=OneTimeCode.Purpose.EMAIL_CHANGE)
        self.assertEqual(record.pending_email, NEW_EMAIL)
        self.assertNotEqual(record.code_hash, last_code())

    def test_the_address_is_normalised(self):
        response = self.request_change(new_email="  Kene.New@EXAMPLE.com ")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(mail.outbox[0].to, ["Kene.New@example.com"])

    def test_a_wrong_password_is_rejected_before_the_address_is_looked_at(self):
        response = self.request_change(new_email="other@example.com", password="not-it-at-all")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"password": [WRONG_PASSWORD_MESSAGE]})
        self.assertEqual(len(mail.outbox), 0)

    def test_the_current_address_is_rejected_in_any_case(self):
        response = self.request_change(new_email=OLD_EMAIL.upper())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["new_email"], [SAME_EMAIL_MESSAGE])
        self.assertEqual(len(mail.outbox), 0)

    def test_an_address_another_account_uses_is_rejected_in_any_case(self):
        response = self.request_change(new_email="OTHER@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["new_email"], [EMAIL_IN_USE_MESSAGE])
        self.assertEqual(len(mail.outbox), 0)

    def test_an_invalid_address_is_rejected(self):
        response = self.request_change(new_email="not-an-email")
        self.assertEqual(response.status_code, 400)
        self.assertIn("new_email", response.data)

    def test_asking_again_inside_the_cooldown_sends_nothing_and_keeps_the_pending_address(self):
        self.request_change()
        response = self.request_change(new_email="second@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertRegex(response.data["detail"], r"^Wait \d+ seconds before asking for another code\.$")
        self.assertEqual(len(mail.outbox), 1)
        record = OneTimeCode.objects.get(user=self.user, purpose=OneTimeCode.Purpose.EMAIL_CHANGE)
        self.assertEqual(record.pending_email, NEW_EMAIL)

    def test_a_failed_send_is_logged_and_still_answers(self):
        with mock.patch("apps.users.emails.send_mail", side_effect=OSError("smtp down")), mock.patch(
            "apps.users.verification.generate_code", return_value="424242"
        ):
            with self.assertLogs("apps.users.verification", level="WARNING") as logs:
                response = self.request_change()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("424242", "\n".join(logs.output))


class EmailChangeConfirmTests(AccountTestCase):
    def setUp(self):
        super().setUp()
        self.request_change()
        self.code = last_code()

    def test_the_right_code_changes_the_email_and_tells_the_old_address(self):
        response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data,
            {"id": self.user.id, "username": "kene", "email": NEW_EMAIL, "time_zone": None, "time_zone_auto": True},
        )
        user = self.reload()
        self.assertEqual(user.email, NEW_EMAIL)
        self.assertTrue(is_verified(user))
        self.assertFalse(OneTimeCode.objects.filter(user=user).exists())

        notice = mail.outbox[-1]
        self.assertEqual(notice.to, [OLD_EMAIL])
        self.assertEqual(notice.subject, "Your StudyPilot email was changed")
        self.assertIn(f"Your StudyPilot email was changed to {NEW_EMAIL}.", notice.body)
        self.assertIn("If this wasn't you, reset your password.", notice.body)
        self.assertIn(NEW_EMAIL, notice.alternatives[0][0])

        self.client.force_authenticate(None)
        self.assertEqual(self.post(TOKEN, identifier=NEW_EMAIL, password=PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, identifier=OLD_EMAIL, password=PASSWORD).status_code, 401)

    def test_a_wrong_code_changes_nothing_and_uses_an_attempt(self):
        response = self.post(CONFIRM_EMAIL, code=self.wrong(self.code))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)
        self.assertEqual(self.reload().email, OLD_EMAIL)
        self.assertEqual(OneTimeCode.objects.get(user=self.user).attempts, 1)
        self.assertEqual(self.post(CONFIRM_EMAIL, code=self.code).status_code, 200)

    def test_five_wrong_attempts_kill_the_code(self):
        for _ in range(MAX_ATTEMPTS):
            self.post(CONFIRM_EMAIL, code=self.wrong(self.code))
        response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.reload().email, OLD_EMAIL)

    def test_an_expired_code_is_rejected(self):
        OneTimeCode.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], BAD_CODE_DETAIL)
        self.assertEqual(self.reload().email, OLD_EMAIL)

    def test_a_used_code_cannot_be_used_again(self):
        self.assertEqual(self.post(CONFIRM_EMAIL, code=self.code).status_code, 200)
        again = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data["detail"], BAD_CODE_DETAIL)

    def test_another_users_code_does_not_work(self):
        self.client.force_authenticate(self.other)
        response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.get(pk=self.other.pk).email, "other@example.com")
        self.assertEqual(self.reload().email, OLD_EMAIL)

    def test_verify_and_reset_codes_cannot_confirm_an_email_change(self):
        OneTimeCode.objects.filter(user=self.user).update(purpose=OneTimeCode.Purpose.RESET)
        self.assertEqual(self.post(CONFIRM_EMAIL, code=self.code).status_code, 400)
        self.assertEqual(self.reload().email, OLD_EMAIL)

    def test_a_newer_request_supersedes_the_older_one(self):
        age_codes(self.user)
        self.assertEqual(self.request_change(new_email="second@example.com").status_code, 200)
        second_code = last_code()
        self.assertEqual(mail.outbox[-1].to, ["second@example.com"])
        self.assertEqual(OneTimeCode.objects.filter(user=self.user).count(), 1)
        if self.code != second_code:
            self.assertEqual(self.post(CONFIRM_EMAIL, code=self.code).status_code, 400)
        self.assertEqual(self.post(CONFIRM_EMAIL, code=second_code).status_code, 200)
        self.assertEqual(self.reload().email, "second@example.com")

    def test_an_address_taken_since_the_code_was_sent_is_refused_and_the_request_ends(self):
        User.objects.create_user(username="sniper", email=NEW_EMAIL.upper(), password=PASSWORD)
        response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Another account now uses that email", response.data["detail"])
        self.assertEqual(self.reload().email, OLD_EMAIL)
        self.assertFalse(OneTimeCode.objects.filter(user=self.user).exists())

    def test_a_pending_reset_code_for_the_old_address_dies(self):
        OneTimeCode.objects.create(
            user=self.user, purpose=OneTimeCode.Purpose.RESET, code_hash="x", expires_at=timezone.now() + timedelta(minutes=5)
        )
        self.post(CONFIRM_EMAIL, code=self.code)
        self.assertFalse(OneTimeCode.objects.filter(user=self.user, purpose="reset").exists())

    def test_a_failed_notice_is_logged_and_the_change_still_applies(self):
        with mock.patch("apps.users.verification.send_email_changed_notice", side_effect=OSError("smtp down")):
            with self.assertLogs("apps.users.verification", level="WARNING"):
                response = self.post(CONFIRM_EMAIL, code=self.code)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reload().email, NEW_EMAIL)


class AccountDeleteTests(AccountTestCase):
    def seed(self, user):
        course = Course.objects.create(user=user, name=f"Calculus {user.pk}")
        StudyPlan.objects.create(user=user, week_start=date(2026, 10, 26), plan_json={"x": 1})
        StudySessionLog.objects.create(user=user, course_name=course.name, planned_minutes=60, actual_minutes=50)
        shown = ShownStrategy.objects.create(
            user=user, course=course, course_name=course.name, strategy_id="retrieval",
            week_start=date(2026, 10, 26), priority=1, basis="settings",
        )
        StrategyFeedback.objects.create(shown=shown, value="helpful")
        GeneratedPlan.objects.create(
            user=user, course=course, week_start=date(2026, 10, 26), input_hash="h", content={}, model_id="m"
        )
        OneTimeCode.objects.create(
            user=user, purpose=OneTimeCode.Purpose.RESET, code_hash="x", expires_at=timezone.now() + timedelta(minutes=5)
        )

    def counts(self, user_id):
        return {
            "courses": Course.objects.filter(user_id=user_id).count(),
            "plans": StudyPlan.objects.filter(user_id=user_id).count(),
            "logs": StudySessionLog.objects.filter(user_id=user_id).count(),
            "shown": ShownStrategy.objects.filter(user_id=user_id).count(),
            "feedback": StrategyFeedback.objects.filter(shown__user_id=user_id).count(),
            "generated": GeneratedPlan.objects.filter(user_id=user_id).count(),
            "codes": OneTimeCode.objects.filter(user_id=user_id).count(),
            "verification": EmailVerification.objects.filter(user_id=user_id).count(),
        }

    def test_deletes_the_user_and_everything_they_own_and_nothing_else(self):
        self.seed(self.user)
        self.seed(self.other)
        feedback_total = StrategyFeedback.objects.count()
        user_id = self.user.pk
        response = self.post(DELETE, password=PASSWORD, confirm="DELETE")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=user_id).exists())
        self.assertEqual(set(self.counts(user_id).values()), {0})
        self.assertEqual(set(self.counts(self.other.pk).values()), {1})
        self.assertEqual(StrategyFeedback.objects.count(), feedback_total - 1)

    def test_sign_in_fails_afterwards(self):
        self.post(DELETE, password=PASSWORD, confirm="DELETE")
        self.client.force_authenticate(None)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=PASSWORD).status_code, 401)
        self.assertEqual(self.post(TOKEN, identifier=OLD_EMAIL, password=PASSWORD).status_code, 401)

    def test_a_wrong_password_is_refused(self):
        response = self.post(DELETE, password="not-it-at-all", confirm="DELETE")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"password": [WRONG_PASSWORD_MESSAGE]})
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_the_confirmation_must_be_exactly_delete(self):
        for confirm in ("delete", "Delete", "DELET", ""):
            with self.subTest(confirm=confirm):
                response = self.post(DELETE, password=PASSWORD, confirm=confirm)
                self.assertEqual(response.status_code, 400)
                self.assertIn("confirm", response.data)
        response = self.post(DELETE, password=PASSWORD, confirm="delete")
        self.assertEqual(response.data["confirm"], [DELETE_CONFIRM_MESSAGE])
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_both_problems_are_reported_together(self):
        response = self.post(DELETE, password="nope-nope-1", confirm="nope")
        self.assertEqual(set(response.data), {"password", "confirm"})


class AccountThrottleTests(AccountTestCase):
    """The password-checking endpoints use the "auth" scope; the email change request also "email"."""

    def limit(self, auth="3/minute", email="1000/hour"):
        cache.clear()
        patcher = mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": auth, "email": email})
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_throttled_after(self, count, url, **payload):
        for attempt in range(count):
            self.assertNotEqual(self.post(url, **payload).status_code, 429, f"request {attempt + 1}")
        self.assertEqual(self.post(url, **payload).status_code, 429)

    def test_each_password_endpoint_uses_the_auth_scope(self):
        for url, payload in (
            (CHANGE_PASSWORD, {"current_password": "wrong-one-1", "new_password": NEW_PASSWORD}),
            (CHANGE_EMAIL, {"password": "wrong-one-1", "new_email": NEW_EMAIL}),
            (CONFIRM_EMAIL, {"code": "123456"}),
            (DELETE, {"password": "wrong-one-1", "confirm": "DELETE"}),
        ):
            with self.subTest(url=url):
                self.limit(auth="3/minute")
                self.assert_throttled_after(3, url, **payload)

    def test_the_email_change_request_counts_against_the_email_scope(self):
        self.limit(auth="1000/minute", email="2/hour")
        self.assert_throttled_after(2, CHANGE_EMAIL, password="wrong-one-1", new_email=NEW_EMAIL)
        # Other account endpoints don't spend the email bucket.
        self.assertNotEqual(self.post(CHANGE_PASSWORD, current_password="x", new_password="y").status_code, 429)
