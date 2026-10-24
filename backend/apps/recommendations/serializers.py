from rest_framework import serializers

from apps.common.fields import FiniteFloatField

from .models import StrategyFeedbackValue


class RecommendationRequestSerializer(serializers.Serializer):
    focus_score = FiniteFloatField(min_value=0, max_value=1)
    completion_rate = FiniteFloatField(min_value=0, max_value=1)
    preferred_style = serializers.ChoiceField(choices=["visual", "reading", "practice", "mixed"])


class RecommendationResponseSerializer(serializers.Serializer):
    strategies = serializers.ListField(child=serializers.CharField())
    confidence = serializers.FloatField()


class RecommendationHistorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    focus_score = serializers.FloatField()
    completion_rate = serializers.FloatField()
    preferred_style = serializers.CharField()
    strategies_json = serializers.ListField(child=serializers.CharField())
    confidence = serializers.FloatField()
    created_at = serializers.DateTimeField()



class StrategyFeedbackRequestSerializer(serializers.Serializer):
    shown_id = serializers.IntegerField(min_value=1)
    value = serializers.ChoiceField(choices=StrategyFeedbackValue.choices)
