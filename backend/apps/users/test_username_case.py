"""Usernames are unique ignoring case at registration, and sign-in tolerates a different casing."""

from io import StringIO

from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .serializers import LOGIN_FAILED_MESSAGE
from .test_email_verification import EMAIL, NEW_PASSWORD, PASSWORD, TOKEN, EmailFlowTestCase
from .verification import mark_verified

TAKEN = "A user with that username already exists."
OTHER_PASSWORD = "Granite-Harbour-9082"


class RegistrationCaseTests(EmailFlowTestCase):
    def test_a_username_differing_only_by_case_is_rejected(self):
        self.verified_user(username="kene", email="kene@example.com")
        response = self.register(username="Kene", email="other@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["username"], [TAKEN])
        self.assertEqual(User.objects.count(), 1)

    def test_the_same_applies_to_an_unverified_account_and_the_other_way_round(self):
        self.register(username="Kene", email="kene@example.com")
        response = self.register(username="KENE", email="other@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["username"], [TAKEN])

    def test_an_unverified_account_can_re_register_with_a_different_casing_of_its_username(self):
        self.register(username="kene")
        response = self.register(username="Kene", password=NEW_PASSWORD)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.count(), 1)
        user = User.objects.get(email=EMAIL)
        self.assertTrue(user.check_password(NEW_PASSWORD))
        self.assertEqual(user.username, "kene")

    def test_re_registering_under_a_different_name_is_still_rejected(self):
        self.register(username="kene")
        response = self.register(username="keneth")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_a_verified_account_cannot_be_re_registered_under_any_casing(self):
        self.verified_user(username="kene", email=EMAIL)
        response = self.register(username="Kene")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)
        self.assertEqual(len(mail.outbox), 0)


class SignInCaseTests(EmailFlowTestCase):
    def test_another_casing_signs_in_when_it_matches_one_account(self):
        user = self.verified_user(username="kene", email="kene@example.com")
        response = self.post(TOKEN, identifier="KENE", password=PASSWORD)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        me = self.client.get("/api/users/me/", HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        self.assertEqual(me.data["id"], user.id)

    def test_a_wrong_password_under_another_casing_is_the_generic_failure(self):
        self.verified_user(username="kene", email="kene@example.com")
        response = self.post(TOKEN, identifier="KENE", password="wrong-wrong-1")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], LOGIN_FAILED_MESSAGE)

    def test_an_unverified_account_gets_the_distinct_answer_under_another_casing(self):
        self.register(username="kene")
        response = self.post(TOKEN, identifier="KENE", password=PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "email_not_verified")

    def test_the_original_username_field_gets_the_same_tolerance(self):
        self.verified_user(username="kene", email="kene@example.com")
        self.assertEqual(self.post(TOKEN, username="Kene", password=PASSWORD).status_code, 200)

    def test_an_identifier_with_an_at_sign_and_no_email_match_falls_back_to_a_case_insensitive_username(self):
        self.verified_user(username="Ada@Home", email="other@example.com")
        self.assertEqual(self.post(TOKEN, identifier="ada@home", password=PASSWORD).status_code, 200)

    def test_legacy_case_duplicates_each_sign_in_by_their_exact_name_only(self):
        self.verified_user(username="Kene", email="upper@example.com", password=PASSWORD)
        self.verified_user(username="kene", email="lower@example.com", password=OTHER_PASSWORD)
        self.assertEqual(self.post(TOKEN, identifier="Kene", password=PASSWORD).status_code, 200)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=OTHER_PASSWORD).status_code, 200)
        # An exact match is not a hint for the other account: each password only opens its own.
        self.assertEqual(self.post(TOKEN, identifier="Kene", password=OTHER_PASSWORD).status_code, 401)
        self.assertEqual(self.post(TOKEN, identifier="kene", password=PASSWORD).status_code, 401)

    def test_a_third_casing_of_legacy_duplicates_fails_generically_even_with_a_right_password(self):
        self.verified_user(username="Kene", email="upper@example.com", password=PASSWORD)
        self.verified_user(username="kene", email="lower@example.com", password=OTHER_PASSWORD)
        for password in (PASSWORD, OTHER_PASSWORD, "wrong-wrong-1"):
            response = self.post(TOKEN, identifier="KENE", password=password)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.data, {"detail": LOGIN_FAILED_MESSAGE})

    def test_the_email_path_is_unchanged(self):
        self.verified_user(username="Kene", email="kene@example.com")
        self.verified_user(username="kene", email="other@example.com", password=OTHER_PASSWORD)
        self.assertEqual(self.post(TOKEN, identifier="KENE@example.com", password=PASSWORD).status_code, 200)


class ListCaseDuplicateUsernamesTests(TestCase):
    def run_command(self):
        out = StringIO()
        call_command("list_case_duplicate_usernames", stdout=out)
        return out.getvalue()

    def test_reports_when_there_are_none(self):
        User.objects.create_user(username="kene", email="kene@example.com", password=PASSWORD)
        User.objects.create_user(username="keneth", email="keneth@example.com", password=PASSWORD)
        self.assertEqual(self.run_command().strip(), "No usernames differ only by case.")

    def test_lists_each_group_with_the_account_details_and_changes_nothing(self):
        upper = User.objects.create_user(username="Kene", email="upper@example.com", password=PASSWORD)
        lower = User.objects.create_user(username="kene", email="lower@example.com", password=PASSWORD)
        User.objects.create_user(username="solo", email="solo@example.com", password=PASSWORD)
        mark_verified(lower)
        User.objects.filter(pk=lower.pk).update(last_login=timezone.now())
        output = self.run_command()
        self.assertIn("kene: 2 accounts", output)
        self.assertIn(f"id={upper.pk} username=Kene email=upper@example.com", output)
        self.assertIn(f"id={lower.pk} username=kene email=lower@example.com", output)
        self.assertIn("verified=no last_login=never", output)
        self.assertIn("verified=yes last_login=20", output)
        self.assertNotIn("solo", output)
        self.assertIn("1 group(s) found. Nothing was changed.", output)
        self.assertEqual(User.objects.count(), 3)
