from django.test import SimpleTestCase
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
