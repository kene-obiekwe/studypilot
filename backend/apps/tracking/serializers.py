from rest_framework import serializers


class StudySessionLogSerializer(serializers.Serializer):
    course_name = serializers.CharField(max_length=120)
    planned_minutes = serializers.IntegerField(min_value=1)
    actual_minutes = serializers.IntegerField(min_value=0)
    focus_score = serializers.FloatField(min_value=0, max_value=1)
    completion_rate = serializers.FloatField(min_value=0, max_value=1)


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
    planned_minutes = serializers.IntegerField(min_value=1)
    actual_minutes_estimate = serializers.IntegerField(min_value=0, required=False)
    focus_score = serializers.FloatField(min_value=0, max_value=1, required=False, default=0.5)
    completion_rate = serializers.FloatField(min_value=0, max_value=1, required=False, default=0.0)
    help_seeking_rate = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)
    avg_quiz_score_recent = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)

