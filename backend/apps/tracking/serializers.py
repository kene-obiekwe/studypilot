from rest_framework import serializers

from apps.common.fields import FiniteFloatField
from apps.planner.models import Course

UNKNOWN_COURSE_MESSAGE = "Add this course in My courses first."


class StudySessionLogSerializer(serializers.Serializer):
    course_name = serializers.CharField(max_length=120)
    planned_minutes = serializers.IntegerField(min_value=1)
    actual_minutes = serializers.IntegerField(min_value=0)
    focus_score = FiniteFloatField(min_value=0, max_value=1)
    completion_rate = FiniteFloatField(min_value=0, max_value=1)

    def validate_course_name(self, value: str) -> str:
        """Match one of the user's courses ignoring case, and return its stored name."""
        user = self.context["request"].user
        course = Course.objects.filter(user=user, name__iexact=value).order_by("id").first()
        if course is None:
            raise serializers.ValidationError(UNKNOWN_COURSE_MESSAGE)
        return course.name


class StudySessionHistorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    course_name = serializers.CharField()
    planned_minutes = serializers.IntegerField()
    actual_minutes = serializers.IntegerField()
    focus_score = serializers.FloatField()
    completion_rate = serializers.FloatField()
    adherence_score = serializers.FloatField()
    predicted_adherence = serializers.FloatField(allow_null=True)
    model_version = serializers.CharField(allow_blank=True, required=False)
    created_at = serializers.DateTimeField()


class AdherencePredictionRequestSerializer(serializers.Serializer):
    # Old slider fields (planned_minutes, focus_score, ...) are ignored if sent.
    course_name = serializers.CharField(max_length=120, required=False)

