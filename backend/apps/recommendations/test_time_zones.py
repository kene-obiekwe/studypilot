"""Recommendations in the user's time zone (design 7.2, §8): the exam countdown, the rest window and a zone change."""

import json
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from apps.planner.models import Course, StudyPlan
from apps.tracking import inference
from apps.users.models import UserPreferences

from .engine.gather import gather_course_data
from .engine.selection import REST_DAYS
from .models import GeneratedPlan, ShownStrategy

URL = "/api/recommendations/courses/"
FEEDBACK_URL = "/api/recommendations/feedback/"
TIME_ZONE_URL = "/api/users/me/time-zone/"


def utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class ZonedRecommendationsTestCase(APITestCase):
    zone = "Africa/Lagos"

    def setUp(self):
        patcher = mock.patch.object(inference, "get_model", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="zoned", password="TestPass123!")
        UserPreferences.objects.create(user=self.user, time_zone=self.zone, time_zone_auto=False)
        self.user = User.objects.get(pk=self.user.pk)
        self.client.force_authenticate(user=self.user)
        self.course = Course.objects.create(user=self.user, name="HIS 210", learning_demands=["writing", "conceptual"])

    def listing(self, now):
        with mock.patch("django.utils.timezone.now", return_value=now):
            response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def rate(self, now, strategy_id, value):
        shown_id = ShownStrategy.objects.filter(strategy_id=strategy_id).latest("id").id
        with mock.patch("django.utils.timezone.now", return_value=now):
            response = self.client.post(FEEDBACK_URL, {"shown_id": shown_id, "value": value}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data


class KiritimatiTests(ZonedRecommendationsTestCase):
    zone = "Pacific/Kiritimati"  # UTC+14

    def test_kiritimati_monday_morning(self):
        now = utc(2026, 11, 1, 10, 30)  # Monday 2 Nov 00:30 local
        Course.objects.filter(pk=self.course.pk).update(exam_date=date(2026, 11, 2))
        data = self.listing(now)
        self.assertEqual(data["week_start"], "2026-11-02")
        output = data["courses"][0]
        self.assertEqual(output["evidence"]["exam_in_days"], 0)
        self.assertIn("Your exam is today.", json.dumps(output))


class RestWindowTests(ZonedRecommendationsTestCase):
    def test_rest_window_uses_user_day(self):
        rated_at = utc(2026, 10, 4, 23, 30)  # Monday 5 Oct 00:30 in Lagos
        target = next(r["strategy_id"] for r in self.listing(rated_at)["courses"][0]["recommendations"] if r["kind"] == "technique")
        self.assertEqual(self.rate(rated_at, target, "not_helpful")["rating"], "not_helpful")
        ratings = gather_course_data(self.user, self.course, rated_at).ratings
        self.assertEqual(ratings[target].rated_on, date(2026, 10, 5))
        resting = self.listing(rated_at)["courses"][0]["resting"]
        self.assertEqual([(r["strategy_id"], r["until"]) for r in resting], [(target, "2026-11-02")])
        utc_ratings = gather_course_data(self.user, self.course, rated_at, ZoneInfo("UTC")).ratings
        self.assertEqual(utc_ratings[target].rated_on + timedelta(days=REST_DAYS), date(2026, 11, 1))

    def test_the_rest_ends_on_the_users_day(self):
        rated_at = utc(2026, 10, 4, 23, 30)
        target = next(r["strategy_id"] for r in self.listing(rated_at)["courses"][0]["recommendations"] if r["kind"] == "technique")
        self.rate(rated_at, target, "not_helpful")
        # Sunday 1 Nov 23:30Z is already Monday 2 Nov in Lagos (the rest is over); in UTC it would still rest.
        self.assertEqual(self.listing(utc(2026, 11, 1, 22, 30))["courses"][0]["resting"][0]["strategy_id"], target)
        self.assertEqual(self.listing(utc(2026, 11, 1, 23, 30))["courses"][0]["resting"], [])


class ZoneChangeTests(ZonedRecommendationsTestCase):
    def test_zone_change_mid_week_reuses_rows(self):
        StudyPlan.objects.create(user=self.user, week_start=date(2026, 10, 26), plan_json={"allocations": []})
        self.assertEqual(self.listing(utc(2026, 10, 28, 12))["week_start"], "2026-10-26")
        switch = utc(2026, 11, 1, 23, 30)  # Monday 00:30 in Lagos, Sunday 18:30 in New York
        self.assertEqual(self.listing(switch)["week_start"], "2026-11-02")
        response = self.client.put(TIME_ZONE_URL, {"time_zone": "America/New_York", "auto": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.listing(switch)["week_start"], "2026-10-26")

        last_week = ShownStrategy.objects.filter(week_start=date(2026, 10, 26))
        this_week = ShownStrategy.objects.filter(week_start=date(2026, 11, 2))
        self.assertTrue(last_week.exists())
        self.assertEqual(set(last_week.values_list("times_shown", flat=True)), {2})
        self.assertEqual(set(this_week.values_list("times_shown", flat=True)), {1})
        self.assertEqual(StudyPlan.objects.count(), 1)
        self.assertFalse(GeneratedPlan.objects.exists())
