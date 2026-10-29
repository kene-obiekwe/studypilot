from rest_framework import serializers

from .models import StrategyFeedbackValue



class StrategyFeedbackRequestSerializer(serializers.Serializer):
    shown_id = serializers.IntegerField(min_value=1)
    value = serializers.ChoiceField(choices=StrategyFeedbackValue.choices)
