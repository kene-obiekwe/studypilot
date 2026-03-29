from rest_framework import serializers


class PlanRequestSerializer(serializers.Serializer):
    total_available_hours = serializers.FloatField(min_value=1)
    courses = serializers.ListField(child=serializers.DictField(), min_length=1)


class PlanResponseSerializer(serializers.Serializer):
    allocations = serializers.ListField(child=serializers.DictField())
