from rest_framework import serializers

from apps.common.fields import FiniteFloatField

MAX_COURSES = 20
MAX_WEEKLY_HOURS = 168


class CourseInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    difficulty = serializers.IntegerField(min_value=1, max_value=5)


class PlanRequestSerializer(serializers.Serializer):
    total_available_hours = FiniteFloatField(min_value=1, max_value=MAX_WEEKLY_HOURS)
    courses = CourseInputSerializer(many=True, allow_empty=False, min_length=1, max_length=MAX_COURSES)

    def validate_courses(self, courses):
        seen: dict[str, str] = {}
        for course in courses:
            key = course["name"].casefold()
            if key in seen:
                raise serializers.ValidationError(
                    f'Duplicate course name: "{course["name"]}" (already listed as "{seen[key]}").'
                )
            seen[key] = course["name"]
        return courses


class PlanResponseSerializer(serializers.Serializer):
    allocations = serializers.ListField(child=serializers.DictField())


class StudyPlanHistorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    week_start = serializers.DateField()
    plan_json = serializers.JSONField()
    created_at = serializers.DateTimeField()

