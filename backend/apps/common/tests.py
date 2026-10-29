import os
from unittest import mock

from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework import serializers

from config.settings import env_int

from .fields import FiniteFloatField


class ScoreSerializer(serializers.Serializer):
    score = FiniteFloatField(min_value=0, max_value=1)


class FiniteFloatFieldTests(SimpleTestCase):
    def test_non_finite_values_rejected(self):
        for value in ("nan", "NaN", "inf", "-inf", "Infinity", float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                serializer = ScoreSerializer(data={"score": value})
                self.assertFalse(serializer.is_valid())
                self.assertEqual(serializer.errors["score"], ["Must be a finite number."])

    def test_finite_values_accepted(self):
        for value, expected in ((0, 0.0), (1, 1.0), ("0.25", 0.25), (0.5, 0.5)):
            with self.subTest(value=value):
                serializer = ScoreSerializer(data={"score": value})
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(serializer.validated_data["score"], expected)

    def test_range_and_type_errors_still_apply(self):
        for value in (-0.1, 1.1, "abc", None):
            with self.subTest(value=value):
                self.assertFalse(ScoreSerializer(data={"score": value}).is_valid())


class HealthCheckTests(TestCase):
    url = "/api/health/"

    def test_returns_ok_without_auth_or_database(self):
        with self.assertNumQueries(0):
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_head_works_and_other_methods_do_not(self):
        self.assertEqual(self.client.head(self.url).status_code, 200)
        self.assertEqual(self.client.post(self.url).status_code, 405)

    def test_is_not_throttled(self):
        for _ in range(50):
            self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_plain_http_is_not_redirected_to_https(self):
        with override_settings(SECURE_SSL_REDIRECT=True):
            self.assertEqual(self.client.get(self.url).status_code, 200)
            redirected = self.client.get("/api/users/me/")
        self.assertEqual(redirected.status_code, 301)
        self.assertTrue(redirected["Location"].startswith("https://"))


class EnvIntTests(SimpleTestCase):
    def test_reads_a_number_and_ignores_surrounding_spaces(self):
        with mock.patch.dict(os.environ, {"SOME_NUMBER": " 25 "}):
            self.assertEqual(env_int("SOME_NUMBER", 10), 25)

    def test_unset_or_blank_uses_the_default(self):
        with mock.patch.dict(os.environ, {"BLANK_NUMBER": "   "}):
            self.assertEqual(env_int("BLANK_NUMBER", 10), 10)
        self.assertEqual(env_int("NUMBER_THAT_IS_NOT_SET", 10), 10)

    def test_a_non_number_is_an_error_at_startup(self):
        with mock.patch.dict(os.environ, {"BAD_NUMBER": "ten"}), self.assertRaises(ValueError):
            env_int("BAD_NUMBER", 10)

    def test_email_timeout_defaults_to_ten_seconds(self):
        self.assertIsInstance(settings.EMAIL_TIMEOUT, int)
        if not os.environ.get("EMAIL_TIMEOUT", "").strip():
            self.assertEqual(settings.EMAIL_TIMEOUT, 10)
