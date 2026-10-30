"""PUT /api/users/me/time-zone/ and the time-zone fields of the me payload."""

from unittest import mock

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from .models import UserPreferences
from .views import TimeZoneView, me_payload

ME = "/api/users/me/"
TIME_ZONE = "/api/users/me/time-zone/"
DELETE = "/api/users/me/delete/"
PASSWORD = "TestPass123!"

INVALID_NAMES = ["", "Etc/Unknown", "Mars/Olympus", "../etc/passwd", "a" * 65, "africa/lagos", " Africa/Lagos"]


class TimeZoneTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="zoner", email="zoner@example.com", password=PASSWORD)
        self.other = User.objects.create_user(username="other", email="other@example.com", password=PASSWORD)
        self.client.force_authenticate(self.user)

    def put(self, **payload):
        return self.client.put(TIME_ZONE, payload, format="json")

    def stored(self, user=None):
        return UserPreferences.objects.filter(user=user or self.user).first()


class SetTimeZoneTests(TimeZoneTestCase):
    def test_a_valid_zone_is_stored_and_returns_the_me_payload(self):
        response = self.put(time_zone="Africa/Lagos", auto=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data,
            {
                "id": self.user.id,
                "username": "zoner",
                "email": "zoner@example.com",
                "time_zone": "Africa/Lagos",
                "time_zone_auto": True,
            },
        )
        self.assertEqual(self.stored().time_zone, "Africa/Lagos")

    def test_aliases_and_utc_are_accepted(self):
        for name in ("Asia/Calcutta", "UTC", "Africa/Lagos"):
            with self.subTest(name=name):
                response = self.put(time_zone=name, auto=False)
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["time_zone"], name)
                self.assertEqual(self.stored().time_zone, name)

    def test_the_row_is_created_once_and_then_updated(self):
        self.assertIsNone(self.stored())
        self.put(time_zone="Africa/Lagos", auto=True)
        self.put(time_zone="Asia/Tokyo", auto=False)
        self.assertEqual(UserPreferences.objects.filter(user=self.user).count(), 1)
        row = self.stored()
        self.assertEqual((row.time_zone, row.time_zone_auto), ("Asia/Tokyo", False))

    def test_auto_is_stored_and_returned(self):
        self.assertIs(self.put(time_zone="Asia/Tokyo", auto=False).data["time_zone_auto"], False)
        self.assertIs(self.stored().time_zone_auto, False)
        self.assertIs(self.put(time_zone="Asia/Tokyo", auto=True).data["time_zone_auto"], True)
        self.assertIs(self.stored().time_zone_auto, True)

    def test_invalid_names_are_refused_and_leave_the_stored_value_alone(self):
        self.put(time_zone="Africa/Lagos", auto=False)
        for name in INVALID_NAMES:
            with self.subTest(name=name):
                response = self.put(time_zone=name, auto=True)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(list(response.data), ["time_zone"])
                row = self.stored()
                self.assertEqual((row.time_zone, row.time_zone_auto), ("Africa/Lagos", False))

    def test_non_string_names_are_refused(self):
        for value in (None, 5, ["UTC"], {"a": 1}, True):
            with self.subTest(value=value):
                response = self.put(time_zone=value, auto=True)
                self.assertEqual(response.status_code, 400)
                self.assertIn("time_zone", response.data)
        self.assertIsNone(self.stored())

    def test_an_invalid_name_does_not_create_a_row(self):
        self.assertEqual(self.put(time_zone="Mars/Olympus", auto=True).status_code, 400)
        self.assertIsNone(self.stored())

    def test_both_fields_are_required(self):
        response = self.put(auto=True)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(response.data), ["time_zone"])
        response = self.put(time_zone="Africa/Lagos")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(response.data), ["auto"])
        self.assertIsNone(self.stored())

    def test_a_bad_auto_is_reported_on_auto(self):
        response = self.put(time_zone="Africa/Lagos", auto="maybe")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(response.data), ["auto"])
        self.assertIsNone(self.stored())

    def test_only_put_is_allowed(self):
        for method in ("get", "post", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)(TIME_ZONE).status_code, 405, method)

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        response = self.put(time_zone="Africa/Lagos", auto=True)
        self.assertEqual(response.status_code, 401)
        self.assertIsNone(self.stored())

    def test_it_only_changes_the_callers_zone(self):
        self.put(time_zone="Africa/Lagos", auto=True)
        self.assertIsNone(self.stored(self.other))


class MePayloadTests(TimeZoneTestCase):
    def test_unset_is_null_and_auto(self):
        data = self.client.get(ME).data
        self.assertIsNone(data["time_zone"])
        self.assertIs(data["time_zone_auto"], True)

    def test_get_shows_the_zone_after_it_is_set(self):
        self.put(time_zone="America/Los_Angeles", auto=False)
        data = self.client.get(ME).data
        self.assertEqual(data["time_zone"], "America/Los_Angeles")
        self.assertIs(data["time_zone_auto"], False)

    def test_a_blank_stored_zone_reads_as_null(self):
        UserPreferences.objects.create(user=self.user, time_zone="", time_zone_auto=False)
        data = self.client.get(ME).data
        self.assertIsNone(data["time_zone"])
        self.assertIs(data["time_zone_auto"], False)

    def test_patch_returns_the_time_zone_fields(self):
        response = self.client.patch(ME, {"username": "zoner2"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["time_zone"])
        self.assertIs(response.data["time_zone_auto"], True)
        self.put(time_zone="Asia/Tokyo", auto=True)
        response = self.client.patch(ME, {"username": "zoner3"}, format="json")
        self.assertEqual(response.data["time_zone"], "Asia/Tokyo")

    def test_the_payload_costs_one_query_at_most(self):
        self.put(time_zone="Asia/Tokyo", auto=True)
        user = User.objects.get(pk=self.user.pk)
        with self.assertNumQueries(1):
            me_payload(user)


class AccountDeleteTests(TimeZoneTestCase):
    def test_the_row_goes_with_the_account(self):
        self.put(time_zone="Africa/Lagos", auto=True)
        UserPreferences.objects.create(user=self.other, time_zone="Asia/Tokyo")
        response = self.client.post(DELETE, {"password": PASSWORD, "confirm": "DELETE"}, format="json")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(UserPreferences.objects.filter(user_id=self.user.pk).exists())
        self.assertTrue(UserPreferences.objects.filter(user=self.other).exists())


class ThrottleTests(TimeZoneTestCase):
    def test_the_scope_has_a_default_rate(self):
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["time_zone"], "30/hour")

    def test_the_view_uses_the_time_zone_scope(self):
        self.assertEqual(TimeZoneView.throttle_scope, "time_zone")
        self.assertIn(ScopedRateThrottle, TimeZoneView.throttle_classes)

    def test_it_is_throttled_after_the_limit(self):
        patcher = mock.patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"time_zone": "3/hour"})
        patcher.start()
        self.addCleanup(patcher.stop)
        for attempt in range(3):
            self.assertEqual(self.put(time_zone="Africa/Lagos", auto=True).status_code, 200, f"request {attempt + 1}")
        self.assertEqual(self.put(time_zone="Africa/Lagos", auto=True).status_code, 429)
        self.assertEqual(self.stored().time_zone, "Africa/Lagos")
