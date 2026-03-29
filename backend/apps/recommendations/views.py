from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RecommendationRequestSerializer, RecommendationResponseSerializer
from .services import get_recommendations


class RecommendationView(APIView):
    def post(self, request):
        request_serializer = RecommendationRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        payload = request_serializer.validated_data

        strategies = get_recommendations(
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            preferred_style=payload["preferred_style"],
        )

        response_serializer = RecommendationResponseSerializer(data={"strategies": strategies})
        response_serializer.is_valid(raise_exception=True)
        return Response(response_serializer.data)
