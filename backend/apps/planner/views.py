from datetime import timedelta

from django.db.models import Avg
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


class GeneratePlanView(APIView):
    def post(self, request):
        request_serializer = PlanRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        data = request_serializer.validated_data
        allocations = generate_plan(data["total_available_hours"], data["courses"])

        course_names = list(dict.fromkeys(course.get("name", "Unknown") for course in data["courses"]))
        now = timezone.now()
        rule_means = {
            entry["course_name"]: entry["avg_adherence"]
            for entry in StudySessionLog.objects.filter(
                user=request.user,
                course_name__in=course_names,
                created_at__gte=now - timedelta(days=30),
            )
            .values("course_name")
            .annotate(avg_adherence=Avg("adherence_score"))
        }

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
        for course in data["courses"]:
            Course.objects.update_or_create(
                user=request.user,
                name=course.get("name", "Unknown"),
                defaults={
                    "difficulty": int(course.get("difficulty", 3)),
                    "weekly_target_hours": allocation_map.get(course.get("name", "Unknown"), 3.0),
                },
            )

        today = timezone.localdate()
        week_start = today - timedelta(days=today.weekday())
        StudyPlan.objects.create(
            user=request.user,
            week_start=week_start,
            plan_json={
                "total_available_hours": float(data["total_available_hours"]),
                "courses": data["courses"],
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

