"""Token revocation, expiry of unverified accounts, background email, even timing and unique indexes."""

from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from .models import EmailVerification, OneTimeCode
from .serializers import EMAIL_REGISTERED_MESSAGE, USERNAME_TAKEN_MESSAGE, RegisterSerializer, UsernameChangeSerializer
from .test_account import CHANGE_PASSWORD, CONFIRM_EMAIL, DELETE, ME, NEW_EMAIL, AccountTestCase
from .test_email_verification import (
    NEW_PASSWORD,
    PASSWORD,
    RESEND,
    RESET_CONFIRM,
    RESET_REQUEST,
    TOKEN,
    EmailFlowTestCase,
    last_code,
)
from .verification import UNVERIFIED_ACCOUNT_TTL, mark_verified

REFRESH = "/api/auth/token/refresh/"
SIGN_OUT = "/api/auth/token/blacklist/"


def refresh_status(client, token) -> int:
    return client.post(REFRESH, {"refresh": str(token)}, format="json").status_code


class TokenRevocationTests(AccountTestCase):
    def test_password_change_revokes_every_refresh_token_and_returns_a_working_pair(self):
        old = RefreshToken.for_user(self.user)
        other_users = RefreshToken.for_user(self.other)
        response = self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {"detail", "access", "refresh"})
        self.assertEqual(refresh_status(self.client, old), 401)
        self.assertEqual(refresh_status(self.client, response.data["refresh"]), 200)
        self.assertEqual(refresh_status(self.client, other_users), 200)

    def test_a_token_from_signing_in_is_revoked_by_a_password_change(self):
        signed_in = self.post(TOKEN, identifier="kene", password=PASSWORD).data["refresh"]
        self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.assertEqual(refresh_status(self.client, signed_in), 401)

    def test_a_failed_password_change_revokes_nothing(self):
        old = RefreshToken.for_user(self.user)
        response = self.post(CHANGE_PASSWORD, current_password="wrong", new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(refresh_status(self.client, old), 200)

    def test_the_old_access_token_stays_valid_until_it_expires(self):
        old = RefreshToken.for_user(self.user)
        self.post(CHANGE_PASSWORD, current_password=PASSWORD, new_password=NEW_PASSWORD)
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {old.access_token}")
        self.assertEqual(self.client.get(ME).status_code, 200)

    def test_password_reset_revokes_every_refresh_token(self):
        old = RefreshToken.for_user(self.user)
        self.client.force_authenticate(None)
        self.post(RESET_REQUEST, email=OLD_EMAIL)
        response = self.post(RESET_CONFIRM, email=OLD_EMAIL, code=last_code(), new_password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_status(self.client, old), 401)

    def test_a_failed_reset_revokes_nothing(self):
        old = RefreshToken.for_user(self.user)
        self.client.force_authenticate(None)
        self.post(RESET_REQUEST, email=OLD_EMAIL)
        self.post(RESET_CONFIRM, email=OLD_EMAIL, code="000000", new_password=NEW_PASSWORD)
        self.assertEqual(refresh_status(self.client, old), 200)

    def test_confirming_an_email_change_does_not_revoke_tokens(self):
        old = RefreshToken.for_user(self.user)
        self.request_change()
        self.assertEqual(self.post(CONFIRM_EMAIL, code=last_code()).status_code, 200)
        self.assertEqual(refresh_status(self.client, old), 200)

    def test_sign_out_revokes_the_token_in_the_body(self):
        token = RefreshToken.for_user(self.user)
        other_device = RefreshToken.for_user(self.user)
        self.client.force_authenticate(None)
        self.assertEqual(self.post(SIGN_OUT, refresh=str(token)).status_code, 200)
        self.assertEqual(refresh_status(self.client, token), 401)
        self.assertEqual(refresh_status(self.client, other_device), 200)

    def test_sign_out_works_for_a_token_with_no_outstanding_row(self):
        """Tokens issued before the blacklist app was installed have none."""
        token = RefreshToken.for_user(self.user)
        OutstandingToken.objects.all().delete()
        self.assertEqual(self.post(SIGN_OUT, refresh=str(token)).status_code, 200)
        self.assertEqual(refresh_status(self.client, token), 401)

    def test_sign_out_with_a_bad_token_is_refused(self):
        self.assertEqual(self.post(SIGN_OUT, refresh="not-a-token").status_code, 401)

    def test_sign_out_is_throttled_like_sign_in(self):
        with mock.patch.dict("rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES", {"auth": "2/minute"}):
            codes = [self.post(SIGN_OUT, refresh="x").status_code for _ in range(3)]
        self.assertEqual(codes, [401, 401, 429])

    def test_deleting_the_account_is_not_blocked_by_its_tokens(self):
        RefreshToken.for_user(self.user)
        token = RefreshToken.for_user(self.user)
        BlacklistedToken.objects.create(token=OutstandingToken.objects.get(jti=token["jti"]))
        response = self.post(DELETE, password=PASSWORD, confirm="DELETE")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())
        self.assertEqual(OutstandingToken.objects.filter(user__isnull=True).count(), 2)


OLD_EMAIL = "kene@example.com"


def make_user(username, days_old, verified=False, row=False, **extra):
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password=PASSWORD, **extra)
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=days_old))
    if verified:
        mark_verified(user)
    elif row:
        EmailVerification.objects.create(user=user)
    return user


class PurgeUnverifiedAccountsTests(TestCase):
    def run_command(self, *args):
        out = StringIO()
        call_command("purge_unverified_accounts", *args, stdout=out)
        return out.getvalue()

    def seed(self):
        make_user("stale_no_row", 8)
        make_user("stale_empty_row", 8, row=True)
        make_user("fresh", UNVERIFIED_ACCOUNT_TTL.days - 1)
        make_user("verified_old", 400, verified=True)
        make_user("staff_old", 400, is_staff=True)
        make_user("admin_old", 400, is_superuser=True)

    def test_the_limit_is_seven_days(self):
        self.assertEqual(UNVERIFIED_ACCOUNT_TTL, timedelta(days=7))

    def test_dry_run_lists_the_accounts_and_deletes_nothing(self):
        self.seed()
        output = self.run_command("--dry-run")
        self.assertIn("username=stale_no_row", output)
        self.assertIn("username=stale_empty_row", output)
        for name in ("fresh", "verified_old", "staff_old", "admin_old"):
            self.assertNotIn(f"username={name} ", output)
        self.assertIn("2 account(s) would be deleted", output)
        self.assertEqual(User.objects.count(), 6)

    def test_it_deletes_only_expired_unverified_accounts(self):
        self.seed()
        self.assertIn("Deleted 2 account(s).", self.run_command())
        self.assertCountEqual(
            User.objects.values_list("username", flat=True), ["fresh", "verified_old", "staff_old", "admin_old"]
        )

    def test_it_removes_what_the_account_owned(self):
        user = make_user("stale", 8)
        OneTimeCode.objects.create(user=user, purpose="verify", code_hash="x", expires_at=timezone.now())
        self.run_command()
        self.assertFalse(OneTimeCode.objects.exists())

    def test_it_reports_when_there_is_nothing_to_do(self):
        make_user("verified_old", 400, verified=True)
        self.assertIn("No expired unverified accounts.", self.run_command())


class RegisterPurgesAbandonedAccountsTests(EmailFlowTestCase):
    def test_an_expired_unverified_account_does_not_block_its_username_in_any_case(self):
        make_user("Learner", 8)
        response = self.register(username="learner", email="new@example.com")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username__iexact="learner").email, "new@example.com")

    def test_an_expired_unverified_account_does_not_block_its_email_in_any_case(self):
        make_user("abandoned", 8)
        response = self.register(username="learner", email="ABANDONED@example.com")
        self.assertEqual(response.status_code, 201)
        self.assertFalse(User.objects.filter(username="abandoned").exists())

    def test_a_young_unverified_account_still_blocks_a_different_owner(self):
        make_user("learner", 6)
        self.assertEqual(self.register(username="LEARNER", email="new@example.com").status_code, 400)
        self.assertEqual(self.register(username="other", email="learner@example.com").status_code, 400)
        self.assertTrue(User.objects.filter(username="learner").exists())

    def test_a_verified_or_staff_account_is_never_purged_by_registering(self):
        make_user("verified", 400, verified=True)
        make_user("staff", 400, is_staff=True)
        self.assertEqual(self.register(username="VERIFIED", email="a@example.com").status_code, 400)
        self.assertEqual(self.register(username="b", email="staff@example.com").status_code, 400)
        self.assertEqual(User.objects.count(), 2)


class FakeThread:
    started: list = []

    def __init__(self, target, args=(), daemon=None):
        self.target, self.args = target, args

    def start(self):
        FakeThread.started.append(self)


@override_settings(EMAIL_SEND_IN_BACKGROUND=True)
class BackgroundEmailTests(EmailFlowTestCase):
    def setUp(self):
        super().setUp()
        FakeThread.started = []
        patcher = mock.patch("apps.users.verification.threading.Thread", FakeThread)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_nothing_is_sent_during_the_request_or_before_the_commit(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(FakeThread.started, [])
        self.assertEqual(len(mail.outbox), 0)

    def test_the_email_goes_out_from_a_thread_that_gets_plain_values_and_never_queries(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.register()
        self.assertEqual(len(FakeThread.started), 1)
        thread = FakeThread.started[0]
        self.assertTrue(all(isinstance(arg, (str, int)) for arg in thread.args), thread.args)
        with self.assertNumQueries(0):
            thread.target(*thread.args)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["learner@example.com"])

    def test_reset_and_resend_requests_are_sent_the_same_way(self):
        user = self.verified_user()
        unverified = User.objects.create_user(username="pending", email="pending@example.com", password=PASSWORD)
        with self.captureOnCommitCallbacks(execute=True):
            self.post(RESET_REQUEST, email=user.email)
            self.post(RESEND, email=unverified.email, purpose="verify")
        self.assertEqual(len(FakeThread.started), 2)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_failed_send_is_logged_and_swallowed_without_the_code(self):
        with self.captureOnCommitCallbacks(execute=True), mock.patch(
            "apps.users.verification.generate_code", return_value="424242"
        ):
            self.register()
        thread = FakeThread.started[0]
        with mock.patch("apps.users.emails.send_mail", side_effect=OSError("smtp down")):
            with self.assertLogs("apps.users.verification", level="WARNING") as logs:
                thread.target(*thread.args)
        self.assertNotIn("424242", "\n".join(logs.output))

    def test_the_email_changed_notice_is_sent_the_same_way(self):
        user = self.verified_user(username="kene", email="kene@example.com")
        self.client.force_authenticate(user)
        with self.captureOnCommitCallbacks(execute=True):
            self.post("/api/users/me/email/", password=PASSWORD, new_email=NEW_EMAIL)
        thread = FakeThread.started[-1]
        with self.assertNumQueries(0):
            thread.target(*thread.args)
        with self.captureOnCommitCallbacks(execute=True):
            self.post(CONFIRM_EMAIL, code=last_code())
        notice = FakeThread.started[-1]
        self.assertEqual(notice.args[1], "kene@example.com")
        with self.assertNumQueries(0):
            notice.target(*notice.args)
        self.assertEqual(mail.outbox[-1].to, ["kene@example.com"])


class EvenTimingTests(EmailFlowTestCase):
    """Whether or not an address has an account, a request hashes exactly once and does not send inline."""

    def hashes(self, url, **data):
        with mock.patch("apps.users.verification.make_password", return_value="x") as hasher:
            response = self.post(url, **data)
        self.assertEqual(response.status_code, 200)
        return hasher.call_count

    def test_resend_hashes_once_on_every_branch(self):
        pending = User.objects.create_user(username="pending", email="pending@example.com", password=PASSWORD)
        self.verified_user()
        self.assertEqual(self.hashes(RESEND, email="nobody@example.com", purpose="verify"), 1)
        self.assertEqual(self.hashes(RESEND, email="verified@example.com", purpose="verify"), 1)
        self.assertEqual(self.hashes(RESEND, email=pending.email, purpose="verify"), 1)
        self.assertEqual(self.hashes(RESEND, email=pending.email, purpose="verify"), 1)  # cooldown

    def test_reset_request_hashes_once_on_every_branch(self):
        self.verified_user()
        User.objects.create_user(username="pending", email="pending@example.com", password=PASSWORD)
        User.objects.create_user(username="gone", email="gone@example.com", password=PASSWORD, is_active=False)
        self.assertEqual(self.hashes(RESET_REQUEST, email="nobody@example.com"), 1)
        self.assertEqual(self.hashes(RESET_REQUEST, email="pending@example.com"), 1)
        self.assertEqual(self.hashes(RESET_REQUEST, email="gone@example.com"), 1)
        self.assertEqual(self.hashes(RESET_REQUEST, email="verified@example.com"), 1)
        self.assertEqual(self.hashes(RESET_REQUEST, email="verified@example.com"), 1)  # cooldown


class UniqueIndexTests(AccountTestCase):
    def test_the_database_refuses_usernames_that_differ_only_by_case(self):
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            User.objects.create_user(username="KENE", email="x@example.com", password=PASSWORD)
        self.assertIn("auth_user_username_lower_uniq", str(caught.exception))

    def test_the_database_refuses_emails_that_differ_only_by_case_but_not_blank_ones(self):
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            User.objects.create_user(username="x", email="KENE@example.com", password=PASSWORD)
        self.assertIn("auth_user_email_lower_uniq", str(caught.exception))
        User.objects.create_user(username="blank1", email="", password=PASSWORD)
        User.objects.create_user(username="blank2", email="", password=PASSWORD)

    def test_a_registration_race_on_the_username_is_a_400_with_the_usual_message(self):
        with mock.patch.object(RegisterSerializer, "validate", lambda self, attrs: attrs):
            response = self.register(username="KENE", email="new@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"username": [USERNAME_TAKEN_MESSAGE]})

    def test_a_registration_race_on_the_email_is_a_400_with_the_usual_message(self):
        with mock.patch.object(RegisterSerializer, "validate", lambda self, attrs: attrs):
            response = self.register(username="newcomer", email="KENE@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"email": [EMAIL_REGISTERED_MESSAGE]})

    def test_a_username_change_race_is_a_400_with_the_usual_message(self):
        with mock.patch.object(UsernameChangeSerializer, "validate_username", lambda self, value: value):
            response = self.patch(ME, username="other")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"username": [USERNAME_TAKEN_MESSAGE]})
        self.assertEqual(self.reload().username, "kene")

    def test_an_email_confirm_race_is_a_400_with_the_usual_message(self):
        from .views import EMAIL_TAKEN_SINCE_MESSAGE

        self.request_change()
        User.objects.filter(pk=self.other.pk).update(email=NEW_EMAIL.upper())
        with mock.patch("apps.users.views.email_in_use", return_value=False):
            response = self.post(CONFIRM_EMAIL, code=last_code())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"detail": EMAIL_TAKEN_SINCE_MESSAGE})
        self.assertEqual(self.reload().email, OLD_EMAIL)
        self.assertFalse(OneTimeCode.objects.filter(user=self.user).exists())


BEFORE = [("users", "0003_email_change")]
AFTER = [("users", "0004_unique_username_and_email_ignoring_case")]


def index_names():
    with connection.cursor() as cursor:
        return set(connection.introspection.get_constraints(cursor, "auth_user"))


class IndexMigrationTests(TransactionTestCase):
    def setUp(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(BEFORE)
        self.old_apps = self.executor.loader.project_state(BEFORE).apps

    def tearDown(self):
        self.old_apps.get_model("auth", "User").objects.all().delete()
        MigrationExecutor(connection).migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())

    def migrate_forward(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(AFTER)

    def test_it_adds_the_indexes_and_reverses_them(self):
        self.assertFalse({"auth_user_username_lower_uniq", "auth_user_email_lower_uniq"} & index_names())
        self.migrate_forward()
        self.assertTrue({"auth_user_username_lower_uniq", "auth_user_email_lower_uniq"} <= index_names())
        MigrationExecutor(connection).migrate(BEFORE)
        self.assertFalse({"auth_user_username_lower_uniq", "auth_user_email_lower_uniq"} & index_names())

    def test_case_duplicate_usernames_fail_the_migration_and_name_the_command(self):
        User = self.old_apps.get_model("auth", "User")
        User.objects.create(username="kene", email="a@example.com")
        User.objects.create(username="Kene", email="b@example.com")
        with self.assertRaises(RuntimeError) as caught:
            self.migrate_forward()
        self.assertIn("list_case_duplicate_usernames", str(caught.exception))
        self.assertIn("kene", str(caught.exception))
        self.assertFalse({"auth_user_username_lower_uniq"} & index_names())

    def test_case_duplicate_emails_fail_the_migration_and_blank_emails_do_not(self):
        User = self.old_apps.get_model("auth", "User")
        User.objects.create(username="a", email="Same@example.com")
        User.objects.create(username="b", email="same@example.com")
        with self.assertRaises(RuntimeError) as caught:
            self.migrate_forward()
        self.assertIn("same@example.com", str(caught.exception))
        User.objects.filter(username="b").update(email="")
        User.objects.create(username="c", email="")
        self.migrate_forward()
        self.assertTrue({"auth_user_email_lower_uniq"} <= index_names())
