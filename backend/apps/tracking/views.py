from datetime import timedelta

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.planner.models import Course

from .inference import ForecastResult, STATUS_OK, forecast_course
from .models import StudySessionLog
from .serializers import AdherencePredictionRequestSerializer
from .serializers import StudySessionLogSerializer
from .serializers import StudySessionHistorySerializer


def forecast_payload(course_name: str, forecast: ForecastResult) -> dict:
    return {
        "course_name": course_name,
        "status": forecast.status,
        "predicted_adherence": forecast.predicted_adherence,
        "model_version": forecast.model_version,
        "weeks_history": forecast.weeks_history,
        "features": forecast.features,
    }


class SessionLogView(APIView):
    def post(self, request):
        serializer = StudySessionLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        adherence = round(min(max(payload["actual_minutes"] / payload["planned_minutes"], 0.0), 1.0), 2)

        # Forecast for this course's current week, from complete prior weeks only.
        forecast = forecast_course(request.user, payload["course_name"])
        if forecast.status == STATUS_OK:
            predicted_adherence, model_version = forecast.predicted_adherence, forecast.model_version
        else:
            predicted_adherence, model_version = None, forecast.status

        StudySessionLog.objects.create(
            user=request.user,
            course_name=payload["course_name"],
            planned_minutes=payload["planned_minutes"],
            actual_minutes=payload["actual_minutes"],
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            adherence_score=adherence,
            predicted_adherence=predicted_adherence,
            model_version=model_version,
        )

        return Response(
            {
                "message": "Session log accepted",
                "computed": {
                    "adherence": adherence,
                    "predicted_adherence": predicted_adherence,
                    "model_version": model_version,
                    "focus_score": payload["focus_score"],
                    "completion_rate": payload["completion_rate"],
                },
            }
        )


class AdherencePredictionView(APIView):
    def post(self, request):
        serializer = AdherencePredictionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        course_name = serializer.validated_data.get("course_name")
        if course_name:
            course_names = [course_name]
        else:
            course_names = list(
                StudySessionLog.objects.filter(user=request.user)
                .order_by("course_name")
                .values_list("course_name", flat=True)
                .distinct()
            )

        return Response([forecast_payload(name, forecast_course(request.user, name)) for name in course_names])


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

