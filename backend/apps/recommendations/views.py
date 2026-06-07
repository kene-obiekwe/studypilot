from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RecommendationLog
from .serializers import RecommendationRequestSerializer, RecommendationResponseSerializer
from .serializers import RecommendationHistorySerializer
from .services import get_recommendations


class RecommendationView(APIView):
    def post(self, request):
        request_serializer = RecommendationRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        payload = request_serializer.validated_data

        strategies, confidence = get_recommendations(
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            preferred_style=payload["preferred_style"],
        )

        response_serializer = RecommendationResponseSerializer(
            data={"strategies": strategies, "confidence": confidence}
        )
        response_serializer.is_valid(raise_exception=True)

        RecommendationLog.objects.create(
            user=request.user,
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            preferred_style=payload["preferred_style"],
            strategies_json=strategies,
            confidence=confidence,
        )

        return Response(response_serializer.data)


class RecommendationHistoryView(APIView):
    def get(self, request):
        logs = RecommendationLog.objects.filter(user=request.user).order_by("-created_at")[:50]
        serializer = RecommendationHistorySerializer(logs, many=True)
        return Response({"items": serializer.data})

