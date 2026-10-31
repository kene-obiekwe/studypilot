from bisect import bisect_left, bisect_right
from datetime import timedelta

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.clock import zone_for
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
        serializer = StudySessionLogSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        adherence = round(min(max(payload["actual_minutes"] / payload["planned_minutes"], 0.0), 1.0), 2)

        # Forecast for this course's current week, from complete prior weeks only.
        forecast = forecast_course(request.user, payload["course_name"], zone=zone_for(request.user))
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
            # One entry per course regardless of casing, under the casing of its most recent log.
            latest_name: dict[str, str] = {}
            for name in (
                StudySessionLog.objects.filter(user=request.user)
                .order_by("created_at", "id")
                .values_list("course_name", flat=True)
            ):
                latest_name[name.casefold()] = name
            course_names = sorted(latest_name.values(), key=str.casefold)

        zone = zone_for(request.user)
        return Response([forecast_payload(name, forecast_course(request.user, name, zone=zone)) for name in course_names])


class SessionHistoryView(APIView):
    def get(self, request):
        logs = StudySessionLog.objects.filter(user=request.user).order_by("-created_at")[:100]
        serializer = StudySessionHistorySerializer(logs, many=True)
        return Response({"items": serializer.data})


class TrainingDataView(APIView):
    def get(self, request):
        rows = []
        difficulty_by_course: dict[str, int] = {}
        for name, difficulty in Course.objects.filter(user=request.user).order_by("id").values_list(
            "name", "difficulty"
        ):
            difficulty_by_course.setdefault(name, int(difficulty))

        # The 7-day window counts every log of the user, not only the first 1000 rows returned.
        logs = list(StudySessionLog.objects.filter(user=request.user).order_by("created_at", "id"))
        created_times = [log.created_at for log in logs]

        for log in logs[:1000]:
            window_start = bisect_left(created_times, log.created_at - timedelta(days=7))
            window_end = bisect_right(created_times, log.created_at)
            sessions_last_7_days = window_end - window_start

            rows.append(
                {
                    "user_id": request.user.id,
                    "course_name": log.course_name,
                    "difficulty": difficulty_by_course.get(log.course_name, 3),
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

