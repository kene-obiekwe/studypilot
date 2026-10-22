import math

from rest_framework import serializers


class FiniteFloatField(serializers.FloatField):
    """FloatField that rejects NaN and infinity, which slip past min_value/max_value."""

    default_error_messages = {"not_finite": "Must be a finite number."}

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            self.fail("not_finite")
        return value
