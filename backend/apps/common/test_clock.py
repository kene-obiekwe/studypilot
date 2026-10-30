from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth.models import AnonymousUser, User
from django.test import SimpleTestCase, TestCase, override_settings

from apps.users.models import UserPreferences

from .clock import day_start, is_valid_zone, local_date, monday_of, today, week_bounds, zone_for

UTC = dt_timezone.utc


def utc(*args):
    return datetime(*args, tzinfo=UTC)


def hours(bounds):
    start, end = bounds
    return (end.astimezone(UTC) - start.astimezone(UTC)) / timedelta(hours=1)


class LocalDateTests(SimpleTestCase):
    def test_lagos_sunday_late_evening_utc_is_already_monday(self):
        instant = utc(2026, 11, 1, 23, 30)  # a Sunday
        self.assertEqual(instant.weekday(), 6)
        self.assertEqual(local_date(instant, ZoneInfo("Africa/Lagos")), date(2026, 11, 2))
        self.assertEqual(local_date(instant, ZoneInfo("UTC")), date(2026, 11, 1))

    def test_lagos_local_day_is_a_monday(self):
        self.assertEqual(local_date(utc(2026, 11, 1, 23, 30), ZoneInfo("Africa/Lagos")).weekday(), 0)

    def test_los_angeles_monday_early_utc_is_still_sunday(self):
        instant = utc(2026, 10, 26, 2, 0)  # a Monday
        self.assertEqual(instant.weekday(), 0)
        local = local_date(instant, ZoneInfo("America/Los_Angeles"))
        self.assertEqual(local, date(2026, 10, 25))
        self.assertEqual(local.weekday(), 6)

    def test_kiritimati_is_a_day_ahead(self):
        self.assertEqual(local_date(utc(2026, 11, 1, 10, 30), ZoneInfo("Pacific/Kiritimati")), date(2026, 11, 2))

    def test_etc_gmt_plus_12_is_behind(self):
        self.assertEqual(local_date(utc(2026, 10, 26, 11, 0), ZoneInfo("Etc/GMT+12")), date(2026, 10, 25))


class TodayTests(SimpleTestCase):
    def test_uses_the_patched_clock(self):
        with mock.patch("django.utils.timezone.now", return_value=utc(2026, 11, 1, 23, 30)):
            self.assertEqual(today(ZoneInfo("Africa/Lagos")), date(2026, 11, 2))
            self.assertEqual(today(ZoneInfo("UTC")), date(2026, 11, 1))

    def test_an_explicit_now_wins(self):
        with mock.patch("django.utils.timezone.now", return_value=utc(2026, 1, 1)):
            self.assertEqual(today(ZoneInfo("UTC"), now=utc(2026, 6, 15, 12)), date(2026, 6, 15))


class MondayOfTests(SimpleTestCase):
    def test_every_day_of_a_week_maps_to_its_monday(self):
        for offset in range(7):
            self.assertEqual(monday_of(date(2026, 10, 26) + timedelta(days=offset)), date(2026, 10, 26))
        self.assertEqual(monday_of(date(2026, 11, 2)), date(2026, 11, 2))


class WeekBoundsTests(SimpleTestCase):
    def test_a_plain_week_is_168_hours(self):
        self.assertEqual(hours(week_bounds(date(2026, 10, 26), ZoneInfo("Africa/Lagos"))), 168)

    def test_london_week_ending_with_bst_is_169_hours(self):
        start, end = week_bounds(date(2026, 10, 19), ZoneInfo("Europe/London"))
        self.assertEqual(start, utc(2026, 10, 18, 23, 0))
        self.assertEqual(end, utc(2026, 10, 26, 0, 0))
        self.assertEqual(hours((start, end)), 169)
        # Sunday 23:30 GMT is inside this week, not in a gap before the next one.
        self.assertTrue(start <= utc(2026, 10, 25, 23, 30) < end)

    def test_london_week_starting_bst_is_167_hours(self):
        start, end = week_bounds(date(2026, 3, 23), ZoneInfo("Europe/London"))
        self.assertEqual(start, utc(2026, 3, 23, 0, 0))
        self.assertEqual(end, utc(2026, 3, 29, 23, 0))
        self.assertEqual(hours((start, end)), 167)

    def test_new_york_week_ending_with_dst_is_169_hours(self):
        start, end = week_bounds(date(2026, 10, 26), ZoneInfo("America/New_York"))
        self.assertEqual(start, utc(2026, 10, 26, 4, 0))
        self.assertEqual(end, utc(2026, 11, 2, 5, 0))
        self.assertEqual(hours((start, end)), 169)

    def test_consecutive_weeks_share_a_boundary(self):
        zone = ZoneInfo("Europe/London")
        self.assertEqual(week_bounds(date(2026, 10, 19), zone)[1], week_bounds(date(2026, 10, 26), zone)[0])

    def test_kiritimati_week(self):
        start, end = week_bounds(date(2026, 11, 2), ZoneInfo("Pacific/Kiritimati"))
        self.assertEqual(start, utc(2026, 11, 1, 10, 0))
        self.assertEqual(hours((start, end)), 168)

    def test_etc_gmt_plus_12_week(self):
        start, _ = week_bounds(date(2026, 10, 19), ZoneInfo("Etc/GMT+12"))
        self.assertEqual(start, utc(2026, 10, 19, 12, 0))


class DayStartTests(SimpleTestCase):
    def test_santiago_midnight_gap_starts_at_the_transition_instant(self):
        # Clocks jump from 00:00 (-04) to 01:00 (-03) on 6 Sep 2026.
        self.assertEqual(day_start(date(2026, 9, 6), ZoneInfo("America/Santiago")), utc(2026, 9, 6, 4, 0))

    def test_the_gap_day_has_no_lost_instant(self):
        zone = ZoneInfo("America/Santiago")
        before = day_start(date(2026, 9, 5), zone)
        start = day_start(date(2026, 9, 6), zone)
        after = day_start(date(2026, 9, 7), zone)
        self.assertEqual(hours((before, start)), 24)
        self.assertEqual(hours((start, after)), 23)

    def test_an_overlap_at_midnight_uses_the_first_midnight(self):
        # Clocks go from 00:00 (-03) back to 23:00 (-04) on 5 Apr 2026, so 4 Apr 23:00-24:00 happens twice.
        zone = ZoneInfo("America/Santiago")
        start = day_start(date(2026, 4, 5), zone)
        self.assertEqual(local_date(start, zone), date(2026, 4, 5))
        self.assertEqual(local_date(start - timedelta(seconds=1), zone), date(2026, 4, 4))


class ZoneForTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="zoner", email="z@example.com", password="x")

    def fresh(self):
        return User.objects.get(pk=self.user.pk)

    def test_no_row_gives_the_settings_zone(self):
        self.assertEqual(zone_for(self.fresh()), ZoneInfo("UTC"))

    @override_settings(TIME_ZONE="Africa/Lagos")
    def test_no_row_follows_settings_time_zone(self):
        self.assertEqual(zone_for(self.fresh()), ZoneInfo("Africa/Lagos"))

    def test_a_valid_row(self):
        UserPreferences.objects.create(user=self.user, time_zone="Asia/Tokyo")
        self.assertEqual(zone_for(self.fresh()), ZoneInfo("Asia/Tokyo"))

    def test_a_blank_row_gives_the_settings_zone(self):
        UserPreferences.objects.create(user=self.user, time_zone="")
        self.assertEqual(zone_for(self.fresh()), ZoneInfo("UTC"))

    def test_an_invalid_stored_name_falls_back_without_raising(self):
        for name in ("Mars/Olympus", "../etc/passwd", "Etc/Unknown"):
            with self.subTest(name=name):
                UserPreferences.objects.update_or_create(user=self.user, defaults={"time_zone": name})
                self.assertEqual(zone_for(self.fresh()), ZoneInfo("UTC"))

    def test_the_zone_is_cached_on_the_instance_only(self):
        UserPreferences.objects.create(user=self.user, time_zone="Asia/Tokyo")
        user = self.fresh()
        self.assertEqual(zone_for(user), ZoneInfo("Asia/Tokyo"))
        UserPreferences.objects.filter(user=self.user).update(time_zone="Africa/Lagos")
        with self.assertNumQueries(0):
            self.assertEqual(zone_for(user), ZoneInfo("Asia/Tokyo"))
        self.assertEqual(zone_for(self.fresh()), ZoneInfo("Africa/Lagos"))

    def test_an_anonymous_user_gets_the_settings_zone(self):
        self.assertEqual(zone_for(AnonymousUser()), ZoneInfo("UTC"))


class IsValidZoneTests(SimpleTestCase):
    def test_accepts_known_names_and_aliases(self):
        for name in ("Africa/Lagos", "Asia/Calcutta", "UTC", "America/Santiago", "Etc/GMT+12", "Pacific/Kiritimati"):
            with self.subTest(name=name):
                self.assertTrue(is_valid_zone(name))

    def test_rejects_everything_else(self):
        for name in ("", "Etc/Unknown", "Mars/Olympus", "../etc/passwd", "Local", "a" * 65, None, 5, ["UTC"], {}):
            with self.subTest(name=name):
                self.assertFalse(is_valid_zone(name))
