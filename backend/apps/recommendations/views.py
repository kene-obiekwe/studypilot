from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.ai import ai_enabled
from apps.planner.models import Course

from .engine import recommend
from .engine.gather import gather_course_data, local_today, week_start
from .models import ShownStrategy
from .plan import build_plan
from .serializers import StrategyFeedbackRequestSerializer
from .shown import feedback_state, log_shown, record_feedback



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

        return Response(
            {
                "generated_at": now.isoformat(),
                "week_start": monday.isoformat(),
                # Lets the client hide "Write my weekly plan" when only the rules plan exists.
                "ai_plan_available": ai_enabled(),
                "courses": results,
            }
        )


class StrategyFeedbackView(APIView):
    def post(self, request):
        serializer = StrategyFeedbackRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shown = ShownStrategy.objects.filter(pk=serializer.validated_data["shown_id"], user=request.user).first()
        if shown is None:
            raise NotFound("Strategy not found.")
        return Response(record_feedback(shown, serializer.validated_data["value"]))


class CoursePlanView(APIView):
    """This week's plan for one course: AI-written when enabled and valid, otherwise rules-only."""

    def get(self, request, pk):
        course = Course.objects.filter(pk=pk, user=request.user).first()
        if course is None:
            raise NotFound("Course not found.")
        now = timezone.now()
        output = recommend(gather_course_data(request.user, course, now))
        return Response(build_plan(request, course, output, week_start(local_today(now))))
