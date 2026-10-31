"""Days and weeks in the user's time zone (design 7.2, §8): the planner, its logged hours and the week check.

Dates are in 2026. Each scenario fixes the clock and stores a zone for the user (or none, which is UTC).
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from apps.common.clock import day_start, zone_for
from apps.recommendations.models import ShownStrategy
from apps.tracking import inference
from apps.tracking.models import StudySessionLog
from apps.users.models import UserPreferences

from .models import Course
from .weekly import logged_hours_by_name, server_today, validate_week_start

RECOMMENDATIONS_URL = "/api/recommendations/courses/"
COURSES = [{"name": "A", "difficulty": 3}]


def utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class TimeZoneTestCase(APITestCase):
    """A user in `zone` (None: no preferences row) at a fixed `now`, with no forecast model."""

    zone: str | None = None
    now = utc(2026, 10, 28, 12)

    def setUp(self):
        self.set_now(self.now)
        patcher = mock.patch.object(inference, "get_model", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="zoned", password="TestPass123!")
        if self.zone is not None:
            UserPreferences.objects.create(user=self.user, time_zone=self.zone, time_zone_auto=False)
            self.user = User.objects.get(pk=self.user.pk)
        self.client.force_authenticate(user=self.user)
        Course.objects.create(user=self.user, name="A", difficulty=3)

    def set_now(self, now):
        # Stacked on any earlier clock; cleanups stop them in reverse order.
        clock = mock.patch("django.utils.timezone.now", return_value=now)
        clock.start()
        self.addCleanup(clock.stop)

    def log(self, hours, at, name="A"):
        log = StudySessionLog.objects.create(
            user=self.user,
            course_name=name,
            planned_minutes=int(hours * 60),
            actual_minutes=int(hours * 60),
            adherence_score=0.75,
        )
        StudySessionLog.objects.filter(pk=log.pk).update(created_at=at)

    def put(self, week, total_hours=6):
        return self.client.put(f"/api/planner/plans/{week}/", {"courses": COURSES, "total_hours": total_hours}, format="json")

    def preview(self, week, total_hours=6):
        return self.client.post(
            "/api/planner/plans/preview/",
            {"week_start": week, "courses": COURSES, "total_hours": total_hours},
            format="json",
        )

    def recommendations_week(self):
        response = self.client.get(RECOMMENDATIONS_URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["week_start"]

    def logged(self, week_start: date, now=None):
        return logged_hours_by_name(self.user, week_start, now or utc(2027, 1, 1)).get("a", 0.0)


class UnsetZoneTests(TimeZoneTestCase):
    def test_unset_zone_behaves_as_utc(self):
        self.assertFalse(UserPreferences.objects.filter(user=self.user).exists())
        self.assertEqual(zone_for(self.user), ZoneInfo("UTC"))
        self.assertEqual(server_today(), date(2026, 10, 28))
        self.log(1, utc(2026, 10, 25, 23, 30))  # Sunday in UTC: last week
        self.log(2, utc(2026, 10, 26, 0, 30))
        response = self.put("2026-10-26")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data["plan_json"]["counted_hours"], response.data["days_left"]), (2.0, 5))
        self.assertEqual(response.data["plan_json"]["made_on"], "2026-10-28")
        self.assertEqual(self.recommendations_week(), "2026-10-26")
        self.assertEqual(set(ShownStrategy.objects.values_list("week_start", flat=True)), {date(2026, 10, 26)})


class LagosMondayTests(TimeZoneTestCase):
    zone = "Africa/Lagos"
    now = utc(2026, 11, 1, 23, 30)  # Monday 2 Nov 00:30 in Lagos

    def test_lagos_monday_0030_is_the_new_week(self):
        self.assertEqual(server_today(zone=zone_for(self.user)), date(2026, 11, 2))
        self.log(1, utc(2026, 11, 1, 23, 10))  # Monday 00:10 in Lagos
        self.assertEqual(self.recommendations_week(), "2026-11-02")
        response = self.put("2026-11-02")
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["plan_json"]
        self.assertEqual((data["counted_hours"], response.data["days_left"]), (1.0, 7))
        self.assertEqual((data["made_on"], data["courses"][0]["entered_on"]), ("2026-11-02", "2026-11-02"))
        self.assertEqual(self.logged(date(2026, 10, 26)), 0.0)


class LosAngelesSundayTests(TimeZoneTestCase):
    zone = "America/Los_Angeles"
    now = utc(2026, 10, 26, 2)  # Sunday 25 Oct 19:00 PDT

    def test_los_angeles_sunday_evening_is_still_this_week(self):
        self.log(1, utc(2026, 10, 26, 1))  # Sunday 18:00 PDT
        self.assertEqual(self.recommendations_week(), "2026-10-19")
        this_week = self.put("2026-10-19")
        self.assertEqual(this_week.status_code, 200, this_week.data)
        self.assertEqual(this_week.data["plan_json"]["counted_hours"], 1.0)
        next_week = self.put("2026-10-26")
        self.assertEqual(next_week.status_code, 200, next_week.data)
        self.assertEqual((next_week.data["plan_json"]["counted_hours"], next_week.data["days_left"]), (0.0, 7))
        self.assertEqual(self.client.get("/api/planner/plans/2026-10-19/").data["days_left"], 1)


class GmtMinus12Tests(TimeZoneTestCase):
    zone = "Etc/GMT+12"  # UTC-12
    now = utc(2026, 10, 26, 11)  # Sunday 25 Oct 23:00

    def test_gmt_minus_12_sunday_night(self):
        self.assertEqual(server_today(zone=zone_for(self.user)), date(2026, 10, 25))
        self.assertEqual(self.recommendations_week(), "2026-10-19")
        response = self.put("2026-10-19")
        self.assertEqual((response.status_code, response.data["days_left"]), (200, 1))


class WeekBoundaryTests(TimeZoneTestCase):
    """Weeks run local midnight to local midnight, so a DST week is 167 or 169 hours and no log falls between weeks."""

    def use_zone(self, name):
        UserPreferences.objects.create(user=self.user, time_zone=name)
        self.user = User.objects.get(pk=self.user.pk)

    def test_london_week_ending_with_bst_is_169_hours(self):
        self.use_zone("Europe/London")
        self.log(1, utc(2026, 10, 18, 23, 30))  # Monday 19 Oct 00:30 BST
        self.log(2, utc(2026, 10, 25, 23, 30))  # Sunday 25 Oct 23:30 GMT
        self.log(4, utc(2026, 10, 26, 0, 30))  # Monday 26 Oct 00:30 GMT
        self.assertEqual(self.logged(date(2026, 10, 19)), 3.0)
        self.assertEqual(self.logged(date(2026, 10, 26)), 4.0)

    def test_london_week_starting_bst_is_167_hours(self):
        self.use_zone("Europe/London")
        self.log(1, utc(2026, 3, 29, 22, 30))  # Sunday 29 Mar 23:30 BST
        self.log(2, utc(2026, 3, 29, 23, 30))  # Monday 30 Mar 00:30 BST
        self.assertEqual(self.logged(date(2026, 3, 23)), 1.0)
        self.assertEqual(self.logged(date(2026, 3, 30)), 2.0)

    def test_new_york_dst_end(self):
        self.use_zone("America/New_York")
        self.log(1, utc(2026, 11, 2, 4, 30))  # Sunday 1 Nov 23:30 EST
        self.log(2, utc(2026, 11, 2, 5, 30))  # Monday 2 Nov 00:30 EST
        self.assertEqual(self.logged(date(2026, 10, 26)), 1.0)
        self.assertEqual(self.logged(date(2026, 11, 2)), 2.0)

    def test_midnight_gap_zone(self):
        # Santiago skips from 00:00 to 01:00 on Sunday 6 Sep 2026: the day starts at the transition instant.
        self.use_zone("America/Santiago")
        zone = ZoneInfo("America/Santiago")
        self.assertEqual(day_start(date(2026, 9, 6), zone), utc(2026, 9, 6, 4))
        self.log(1, utc(2026, 9, 6, 3, 59))  # Saturday 23:59 -04
        self.log(2, utc(2026, 9, 6, 4))  # Sunday 01:00 -03
        self.log(4, utc(2026, 9, 7, 2, 59))  # Sunday 23:59 -03
        self.log(8, utc(2026, 9, 7, 3))  # Monday 7 Sep 00:00 -03
        self.assertEqual(self.logged(date(2026, 8, 31)), 7.0)
        self.assertEqual(self.logged(date(2026, 9, 7)), 8.0)
        points = inference.session_points(StudySessionLog.objects.order_by("created_at"), zone)
        self.assertEqual(
            [p.day for p in points], [date(2026, 9, 5), date(2026, 9, 6), date(2026, 9, 6), date(2026, 9, 7)]
        )

    def test_hours_logged_count_only_up_to_now(self):
        self.use_zone("Africa/Lagos")
        self.log(1, utc(2026, 10, 27, 9))
        self.log(2, utc(2026, 10, 29, 9))
        self.assertEqual(self.logged(date(2026, 10, 26), now=utc(2026, 10, 28, 12)), 1.0)


class WeekStartSlackTests(TimeZoneTestCase):
    zone = "Africa/Lagos"

    def test_week_start_slack(self):
        for week, status in (("2026-10-26", 200), ("2026-11-02", 200), ("2026-10-19", 400), ("2026-11-09", 400)):
            with self.subTest(week=week):
                self.assertEqual(self.preview(week).status_code, status)
        self.assertIn("week_start", self.put("2026-10-19").data)
        self.set_now(utc(2026, 11, 1, 23, 30))  # Monday 2 Nov 00:30 in Lagos
        for week, status in (("2026-10-26", 200), ("2026-11-02", 200), ("2026-11-09", 200), ("2026-10-19", 400)):
            with self.subTest(monday=week):
                self.assertEqual(self.preview(week).status_code, status)


class ValidateWeekStartTests(SimpleTestCase):
    def check(self, week_start, today):
        return validate_week_start(week_start, today) is None

    def test_this_and_next_week_with_a_day_either_side(self):
        wednesday = date(2026, 10, 28)
        self.assertEqual(
            [self.check(date(2026, 10, d), wednesday) for d in (19, 26)] + [self.check(date(2026, 11, 2), wednesday)],
            [False, True, True],
        )
        monday = date(2026, 11, 2)  # today - 1 day is last week's Sunday
        self.assertTrue(self.check(date(2026, 10, 26), monday))
        self.assertTrue(self.check(date(2026, 11, 9), monday))
        sunday = date(2026, 11, 1)  # today + 1 day is next week's Monday
        self.assertTrue(self.check(date(2026, 11, 9), sunday))
        self.assertFalse(self.check(date(2026, 10, 19), sunday))
        tuesday = date(2026, 11, 3)
        self.assertFalse(self.check(date(2026, 10, 26), tuesday))

    def test_not_a_monday(self):
        self.assertEqual(validate_week_start(date(2026, 10, 27), date(2026, 10, 28)), "week_start must be a Monday.")
