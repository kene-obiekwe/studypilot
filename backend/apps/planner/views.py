from datetime import timedelta

from django.db.models import Avg, FloatField, Value
from django.db.models.functions import Greatest, Least
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, StudyPlan
from .serializers import PlanRequestSerializer, PlanResponseSerializer, StudyPlanHistorySerializer
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
            # Course names match case-insensitively; an existing course keeps its stored name.
            existing = Course.objects.filter(user=request.user, name__iexact=course["name"]).order_by("id").first()
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

