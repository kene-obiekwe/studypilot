from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.planner.models import Course

from .inference import build_feature_payload, predict_adherence
from .models import StudySessionLog
from .serializers import AdherencePredictionRequestSerializer
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

        log = StudySessionLog.objects.create(
            user=request.user,
            course_name=payload["course_name"],
            planned_minutes=payload["planned_minutes"],
            actual_minutes=payload["actual_minutes"],
            focus_score=payload["focus_score"],
            completion_rate=payload["completion_rate"],
            adherence_score=adherence,
        )

        sessions_last_7_days = StudySessionLog.objects.filter(
            user=request.user,
            created_at__gte=log.created_at - timedelta(days=7),
            created_at__lte=log.created_at,
        ).count()

        first_log = StudySessionLog.objects.filter(user=request.user).order_by("created_at").first()
        created_at_offset_days = 0
        if first_log:
            created_at_offset_days = (log.created_at - first_log.created_at).days

        consistency_score = min(1.0, sessions_last_7_days / 7.0)
        feature_payload = build_feature_payload(
            planned_minutes=payload["planned_minutes"],
            completion_rate=payload["completion_rate"],
            sessions_last_7_days=sessions_last_7_days,
            focus_score=payload["focus_score"],
            consistency_score=consistency_score,
            created_at_offset_days=created_at_offset_days,
        )

        predicted_adherence, model_version = predict_adherence(feature_payload)
        log.predicted_adherence = predicted_adherence
        log.model_version = model_version
        log.save(update_fields=["predicted_adherence", "model_version"])

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
        payload = serializer.validated_data

        planned_minutes = payload["planned_minutes"]
        actual_minutes_estimate = payload.get("actual_minutes_estimate", planned_minutes)
        focus_score = payload.get("focus_score", 0.5)
        completion_rate = payload.get("completion_rate", 0.0)
        help_seeking_rate = payload.get("help_seeking_rate")
        avg_quiz_score_recent = payload.get("avg_quiz_score_recent")

        now = timezone.now()
        sessions_last_7_days = StudySessionLog.objects.filter(
            user=request.user,
            created_at__gte=now - timedelta(days=7),
            created_at__lte=now,
        ).count()

        first_log = StudySessionLog.objects.filter(user=request.user).order_by("created_at").first()
        created_at_offset_days = 0
        if first_log:
            created_at_offset_days = (now - first_log.created_at).days

        consistency_score = min(1.0, sessions_last_7_days / 7.0)
        feature_payload = build_feature_payload(
            planned_minutes=planned_minutes,
            completion_rate=completion_rate,
            sessions_last_7_days=sessions_last_7_days,
            focus_score=focus_score,
            consistency_score=consistency_score,
            created_at_offset_days=created_at_offset_days,
            help_seeking_rate=help_seeking_rate,
            avg_quiz_score_recent=avg_quiz_score_recent,
        )

        predicted_adherence, model_version = predict_adherence(feature_payload)

        return Response(
            {
                "predicted_adherence": predicted_adherence,
                "model_version": model_version,
                "inputs": {
                    "planned_minutes": planned_minutes,
                    "actual_minutes_estimate": actual_minutes_estimate,
                    "focus_score": focus_score,
                    "completion_rate": completion_rate,
                    "help_seeking_rate": help_seeking_rate,
                    "avg_quiz_score_recent": avg_quiz_score_recent,
                    "sessions_last_7_days": sessions_last_7_days,
                    "consistency_score": consistency_score,
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

