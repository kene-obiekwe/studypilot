from datetime import date

from django.db import transaction
from django.db.models.functions import Lower
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, StudyPlan
from .serializers import (
    CourseSerializer,
    TraitSuggestionRequestSerializer,
    WeeklyPlanPreviewSerializer,
    WeeklyPlanRequestSerializer,
    WeeklyPlanSerializer,
)
from .traits import suggest_traits
from .weekly import (
    PlanConflict,
    PlanInputError,
    build_revision,
    current_plan,
    days_left,
    drop_course_from_plans,
    rename_course_in_plans,
    revision_counts,
    save_revision,
    server_today,
    validate_week_start,
)
from apps.common.clock import zone_for
from apps.tracking.models import StudySessionLog

CONFLICT_DETAIL = {
    "plan_exists": "You already have a plan for this week. Update it instead.",
    "plan_changed": "This week's plan changed since you opened it. Review the new plan first.",
}


def _conflict(error: PlanConflict) -> Response:
    return Response(
        {
            "code": error.code,
            "detail": CONFLICT_DETAIL[error.code],
            "current_revision": error.current.revision if error.current is not None else None,
        },
        status=409,
    )


def _parse_week_start(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({"week_start": ["Use YYYY-MM-DD."]})


def _check_plannable(week_start: date, today: date) -> None:
    problem = validate_week_start(week_start, today)
    if problem:
        raise ValidationError({"week_start": [problem]})


def _serialize(user, plans: list[StudyPlan]) -> list:
    counts = revision_counts(user, [plan.week_start for plan in plans])
    return WeeklyPlanSerializer(plans, many=True, context={"revision_counts": counts}).data


class WeeklyPlanListView(APIView):
    """The current plan of each week, newest week first, with how many revisions each week has."""

    def get(self, request):
        try:
            limit = min(max(int(request.query_params.get("limit", 20)), 1), 100)
        except ValueError:
            raise ValidationError({"limit": ["A valid integer is required."]})
        plans = list(StudyPlan.objects.filter(user=request.user, is_current=True).order_by("-week_start")[:limit])
        return Response({"items": _serialize(request.user, plans)})


class WeeklyPlanPreviewView(APIView):
    """The split a save would make, with nothing saved. Same checks (and 409s) as saving."""

    def post(self, request):
        serializer = WeeklyPlanPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        week = data["week_start"]
        zone = zone_for(request.user)
        _check_plannable(week, server_today(zone=zone))
        current = current_plan(request.user, week)
        base = data["base_revision"]
        if base is None and current is not None:
            return _conflict(PlanConflict("plan_exists", current))
        if base is not None and (current is None or current.revision != base):
            return _conflict(PlanConflict("plan_changed", current))
        try:
            revision = build_revision(
                request.user,
                week,
                [dict(course) for course in data["courses"]],
                total_hours=data.get("total_hours"),
                more_hours=data.get("more_hours"),
                previous=current,
                zone=zone,
            )
        except PlanInputError as error:
            raise ValidationError({error.field: [error.message]})
        return Response(
            {
                "week_start": week.isoformat(),
                "base_revision": current.revision if current is not None else None,
                "days_left": revision.days_left,
                "clamped": revision.plan_json["clamped"],
                "plan_json": revision.plan_json,
            }
        )


class WeeklyPlanDetailView(APIView):
    """GET a week's current plan (?revisions=1 adds the superseded ones); PUT saves its next revision."""

    def get(self, request, week_start: str):
        week = _parse_week_start(week_start)
        current = current_plan(request.user, week)
        if current is None:
            raise NotFound("No plan for this week.")
        body = _serialize(request.user, [current])[0]
        body["days_left"] = days_left(week, server_today(zone=zone_for(request.user)))
        if request.query_params.get("revisions") in ("1", "true"):
            older = StudyPlan.objects.filter(user=request.user, week_start=week, is_current=False).order_by("revision")
            body["revisions"] = _serialize(request.user, list(older))
        return Response(body)

    def put(self, request, week_start: str):
        week = _parse_week_start(week_start)
        zone = zone_for(request.user)
        _check_plannable(week, server_today(zone=zone))
        serializer = WeeklyPlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            plan, revision = save_revision(
                request.user,
                week,
                [dict(course) for course in data["courses"]],
                base_revision=data["base_revision"],
                total_hours=data.get("total_hours"),
                more_hours=data.get("more_hours"),
                zone=zone,
            )
        except PlanConflict as error:
            return _conflict(error)
        except PlanInputError as error:
            raise ValidationError({error.field: [error.message]})
        body = _serialize(request.user, [plan])[0]
        body["days_left"] = revision.days_left
        return Response(body)


class CourseListCreateView(generics.ListCreateAPIView):
    """The signed-in user's courses. GET lists them by name, ignoring case; POST adds one."""

    serializer_class = CourseSerializer

    def get_queryset(self):
        return Course.objects.filter(user=self.request.user).order_by(Lower("name"), "id")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class CourseDetailView(generics.RetrieveUpdateDestroyAPIView):
    """One of the signed-in user's courses; another user's course id is a 404.

    PATCH renames update the user's session logs that carry the old name (ignoring case) in the same
    transaction, so history stays attached to the course, and rename the course in this week's and
    next week's current plans.

    DELETE removes the course and revises this week's and next week's plans without it (the other
    courses keep their hours). Session logs and earlier plan revisions are kept, still carrying the
    old course name.
    """

    serializer_class = CourseSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Course.objects.filter(user=self.request.user)

    def perform_update(self, serializer):
        with transaction.atomic():
            old_name = serializer.instance.name
            course = serializer.save()
            if course.name != old_name:
                StudySessionLog.objects.filter(user=course.user, course_name__iexact=old_name).update(
                    course_name=course.name
                )
                rename_course_in_plans(course, old_name, zone=zone_for(self.request.user))

    def perform_destroy(self, instance):
        with transaction.atomic():
            drop_course_from_plans(instance, zone=zone_for(self.request.user))
            instance.delete()


class SuggestTraitsView(APIView):
    """Suggested learning traits for a course name, for the user to confirm. Nothing is saved."""

    def post(self, request):
        serializer = TraitSuggestionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(suggest_traits(request, serializer.validated_data["name"]))
