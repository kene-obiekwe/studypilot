from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.ai import ai_enabled
from apps.planner.models import Course

from .engine import recommend
from .engine.gather import gather_course_data, local_today, week_start
from .engine.selection import current_ratings
from .models import ShownStrategy
from .plan import build_plan, latest_plans, plan_envelope, saved_plan_statuses, saved_response
from .serializers import ShowAgainRequestSerializer, StrategyFeedbackRequestSerializer
from .shown import clear_rating, feedback_state, log_shown, record_feedback



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
        courses = list(courses)
        ai_plan_available = ai_enabled()
        statuses = {}
        if ai_plan_available:
            statuses = saved_plan_statuses(request.user, courses, latest_plans(request.user, courses, monday))
        results = []
        with transaction.atomic():
            for course in courses:
                data = gather_course_data(request.user, course, now)
                output = recommend(data)
                # Resting strategies are not in the recommendations, so they are not logged as shown.
                shown = log_shown(request.user, course, output["recommendations"], monday, now)
                # The rating persists across weeks (StrategyRating); tried is this week's row only.
                ratings = current_ratings(data)
                states = feedback_state(
                    [row.id for row in shown.values()],
                    {row.id: ratings.get(strategy_id) for strategy_id, row in shown.items()},
                )
                for rec in output["recommendations"]:
                    row = shown[rec["strategy_id"]]
                    rec["shown_id"] = row.id
                    rec["feedback"] = states[row.id]
                # Whether this week's AI plan was written and what changed since; null with none.
                output["saved_plan"] = statuses.get(course.id)
                results.append(output)

        return Response(
            {
                "generated_at": now.isoformat(),
                "week_start": monday.isoformat(),
                # Lets the client hide "Write my weekly plan" when only the rules plan exists.
                "ai_plan_available": ai_plan_available,
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


class ShowAgainView(APIView):
    """Undo a rating, so a strategy marked not helpful can be recommended again."""

    def post(self, request):
        serializer = ShowAgainRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course = Course.objects.filter(pk=serializer.validated_data["course_id"], user=request.user).first()
        strategy_id = serializer.validated_data["strategy_id"]
        if course is None or not clear_rating(request.user, course, strategy_id):
            raise NotFound("Rating not found.")
        return Response({"course_id": course.id, "strategy_id": strategy_id, "rating": None})


class CoursePlanView(APIView):
    """This week's plan for one course.

    GET only reads: the newest plan written this week, with whether sessions or settings changed
    since (`saved` is null when none was written; with AI off it is the rules-only plan). It never
    calls the model. POST writes: it returns the saved plan untouched while nothing has changed,
    and otherwise asks the model (cache, daily limit and validation as before), falling back to
    the rules-only plan, which is not saved. Either way the status fields describe the saved plan.
    """

    def _course(self, request, pk):
        course = Course.objects.filter(pk=pk, user=request.user).first()
        if course is None:
            raise NotFound("Course not found.")
        return course

    def _rules(self, request, course, now, monday):
        output = recommend(gather_course_data(request.user, course, now))
        return plan_envelope(build_plan(request, course, output, monday), None, monday)

    def get(self, request, pk):
        course = self._course(request, pk)
        now = timezone.now()
        monday = week_start(local_today(now))
        if not ai_enabled():
            return Response(self._rules(request, course, now, monday))
        plans = latest_plans(request.user, [course], monday)
        status = saved_plan_statuses(request.user, [course], plans)[course.id]
        saved = saved_response(plans[course.id], monday) if course.id in plans else None
        return Response(plan_envelope(saved, status, monday))

    def post(self, request, pk):
        course = self._course(request, pk)
        now = timezone.now()
        monday = week_start(local_today(now))
        if not ai_enabled():
            return Response(self._rules(request, course, now, monday))

        plans = latest_plans(request.user, [course], monday)
        status = saved_plan_statuses(request.user, [course], plans)[course.id]
        if status is not None and not status["outdated"]:
            return Response(plan_envelope(saved_response(plans[course.id], monday), status, monday))

        output = recommend(gather_course_data(request.user, course, now))
        written = build_plan(request, course, output, monday)
        plans = latest_plans(request.user, [course], monday)
        return Response(plan_envelope(written, saved_plan_statuses(request.user, [course], plans)[course.id], monday))
