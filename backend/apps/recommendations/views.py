from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.planner.models import Course

from .engine import recommend
from .engine.gather import gather_course_data, local_today, week_start
from .models import RecommendationLog, ShownStrategy
from .serializers import RecommendationRequestSerializer, RecommendationResponseSerializer
from .serializers import RecommendationHistorySerializer, StrategyFeedbackRequestSerializer
from .services import get_recommendations
from .shown import feedback_state, log_shown, record_feedback


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



class CourseRecommendationsView(APIView):
    """Structured, course-aware recommendations. Each one shown is logged once per ISO week."""

    def get(self, request):
        courses = Course.objects.filter(user=request.user).order_by("name", "id")
        raw_id = request.query_params.get("course_id")
        if raw_id is not None:
            try:
                course_id = int(raw_id)
            except ValueError:
                raise ValidationError({"course_id": ["A valid integer is required."]})
            courses = courses.filter(pk=course_id)
            if not courses.exists():
                raise NotFound("Course not found.")

        now = timezone.now()
        monday = week_start(local_today(now))
        results = []
        with transaction.atomic():
            for course in courses:
                output = recommend(gather_course_data(request.user, course, now))
                shown = log_shown(request.user, course, output["recommendations"], monday, now)
                states = feedback_state([row.id for row in shown.values()])
                for rec in output["recommendations"]:
                    row = shown[rec["strategy_id"]]
                    rec["shown_id"] = row.id
                    rec["feedback"] = states[row.id]
                results.append(output)

        return Response({"generated_at": now.isoformat(), "week_start": monday.isoformat(), "courses": results})


class StrategyFeedbackView(APIView):
    def post(self, request):
        serializer = StrategyFeedbackRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shown = ShownStrategy.objects.filter(pk=serializer.validated_data["shown_id"], user=request.user).first()
        if shown is None:
            raise NotFound("Strategy not found.")
        return Response(record_feedback(shown, serializer.validated_data["value"]))
