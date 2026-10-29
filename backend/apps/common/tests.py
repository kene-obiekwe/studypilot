from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework import serializers

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
