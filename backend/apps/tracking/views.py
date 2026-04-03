from datetime import timedelta

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.planner.models import Course

from .models import StudySessionLog
from .serializers import StudySessionLogSerializer
from .serializers import StudySessionHistorySerializer


class SessionLogView(APIView):
    def post(self, request):
        serializer = StudySessionLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        adherence = 0.0
        if payload["planned_minutes"] > 0:
            adherence = round(payload["actual_minutes"] / payload["planned_minutes"], 2)

        StudySessionLog.objects.create(
            user=request.user,
            course_name=payload["course_name"],
            planned_minutes=payload["planned_minutes"],
            actual_minutes=payload["actual_minutes"],
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            adherence_score=adherence,
        )

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


class SessionHistoryView(APIView):
    def get(self, request):
        logs = StudySessionLog.objects.filter(user=request.user).order_by("-created_at")[:100]
        serializer = StudySessionHistorySerializer(logs, many=True)
        return Response({"items": serializer.data})


class TrainingDataView(APIView):
    def get(self, request):
        rows = []
        logs = StudySessionLog.objects.filter(user=request.user).order_by("created_at")[:1000]

        for log in logs:
            course = Course.objects.filter(user=request.user, name=log.course_name).first()
            sessions_last_7_days = StudySessionLog.objects.filter(
                user=request.user,
                created_at__gte=log.created_at - timedelta(days=7),
                created_at__lte=log.created_at,
            ).count()

            rows.append(
                {
                    "user_id": request.user.id,
                    "course_name": log.course_name,
                    "difficulty": int(course.difficulty) if course else 3,
                    "planned_minutes": log.planned_minutes,
                    "actual_minutes": log.actual_minutes,
                    "focus_score": log.focus_score,
                    "completion_rate": log.completion_rate,
                    "adherence_score": log.adherence_score,
                    "sessions_last_7_days": sessions_last_7_days,
                    "created_at": log.created_at,
                }
            )

        return Response({"rows": rows, "count": len(rows)})

