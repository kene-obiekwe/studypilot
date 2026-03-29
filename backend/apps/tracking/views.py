from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import StudySessionLogSerializer


class SessionLogView(APIView):
    def post(self, request):
        serializer = StudySessionLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        adherence = 0.0
        if payload["planned_minutes"] > 0:
            adherence = round(payload["actual_minutes"] / payload["planned_minutes"], 2)

        return Response(
            {
                "message": "Session log accepted",
                "computed": {
                    "adherence": adherence,
                    "focus_score": payload["focus_score"],
                    "completion_rate": payload["completion_rate"],
                },
            }
        )
