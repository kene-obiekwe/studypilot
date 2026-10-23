from datetime import timedelta

from django.db import transaction
from django.db.models import Avg, FloatField, Value
from django.db.models.functions import Greatest, Least, Lower
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, StudyPlan
from .serializers import (
    CourseSerializer,
    PlanRequestSerializer,
    PlanResponseSerializer,
    StudyPlanHistorySerializer,
)
from .services import (
    ADJUSTMENT_SOURCE_NONE,
    annotate_adjustment_sources,
    apply_adherence_adjustments,
    generate_plan,
    resolve_adjustment,
)
from apps.tracking.inference import STATUS_OK, forecast_course
from apps.tracking.models import StudySessionLog

ZERO = Value(0.0, output_field=FloatField())
ONE = Value(1.0, output_field=FloatField())


class GeneratePlanView(APIView):
    def post(self, request):
        request_serializer = PlanRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        data = request_serializer.validated_data
        courses = [dict(course) for course in data["courses"]]

        # An existing course keeps its stored name everywhere: allocations, plan history and lookups.
        stored: dict[str, Course] = {}
        for existing in Course.objects.filter(user=request.user).order_by("id"):
            stored.setdefault(existing.name.casefold(), existing)
        for course in courses:
            match = stored.get(course["name"].casefold())
            if match is not None:
                course["name"] = match.name

        allocations = generate_plan(data["total_available_hours"], courses)

        course_names = [course["name"] for course in courses]
        now = timezone.now()
        rule_means = {}
        for name in course_names:
            mean = StudySessionLog.objects.filter(
                user=request.user,
                course_name__iexact=name,
                created_at__gte=now - timedelta(days=30),
            ).aggregate(
                # Logs written before adherence was capped at log time can exceed 1.
                avg_adherence=Avg(Least(Greatest("adherence_score", ZERO), ONE))
            )["avg_adherence"]
            if mean is not None:
                rule_means[name] = mean

        adjustments: dict[str, dict] = {}
        for name in course_names:
            forecast = forecast_course(request.user, name, now=now)
            forecast_value = forecast.predicted_adherence if forecast.status == STATUS_OK else None
            adjustments[name] = resolve_adjustment(forecast_value, rule_means.get(name))

        adherence_factors = {
            name: adjustment["factor"]
            for name, adjustment in adjustments.items()
            if adjustment["source"] != ADJUSTMENT_SOURCE_NONE
        }
        if adherence_factors:
            allocations = apply_adherence_adjustments(
                allocations,
                data["total_available_hours"],
                adherence_factors,
            )
        allocations = annotate_adjustment_sources(allocations, adjustments)

        response_serializer = PlanResponseSerializer(data={"allocations": allocations})
        response_serializer.is_valid(raise_exception=True)

        allocation_map = {item["course"]: float(item["allocated_hours"]) for item in allocations}
        for course in courses:
            fields = {
                "difficulty": course["difficulty"],
                "weekly_target_hours": allocation_map[course["name"]],
            }
            existing = stored.get(course["name"].casefold())
            if existing is None:
                Course.objects.create(user=request.user, name=course["name"], **fields)
            else:
                for field, value in fields.items():
                    setattr(existing, field, value)
                existing.save(update_fields=list(fields))

        today = timezone.localdate()
        week_start = today - timedelta(days=today.weekday())
        StudyPlan.objects.create(
            user=request.user,
            week_start=week_start,
            plan_json={
                "total_available_hours": float(data["total_available_hours"]),
                "courses": courses,
                "allocations": allocations,
                "adherence_adjustments": adherence_factors,
            },
        )

        return Response(response_serializer.data)


class StudyPlanHistoryView(APIView):
    def get(self, request):
        plans = StudyPlan.objects.filter(user=request.user).order_by("-created_at")[:20]
        serializer = StudyPlanHistorySerializer(plans, many=True)
        return Response({"items": serializer.data})


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
    transaction, so history stays attached to the course.

    DELETE removes the course only. Session logs and plan history are kept, still carrying the old
    course name.
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
