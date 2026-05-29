from datetime import timedelta

from django.db.models import Avg
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, StudyPlan
from .serializers import PlanRequestSerializer, PlanResponseSerializer, StudyPlanHistorySerializer
from .services import apply_adherence_adjustments, generate_plan
from apps.tracking.models import StudySessionLog


class GeneratePlanView(APIView):
    def post(self, request):
        request_serializer = PlanRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        data = request_serializer.validated_data
        allocations = generate_plan(data["total_available_hours"], data["courses"])

        course_names = [course.get("name", "Unknown") for course in data["courses"]]
        adherence_factors: dict[str, float] = {}
        if course_names:
            cutoff = timezone.now() - timedelta(days=30)
            adherence_avgs = (
                StudySessionLog.objects.filter(
                    user=request.user,
                    course_name__in=course_names,
                    created_at__gte=cutoff,
                )
                .values("course_name")
                .annotate(avg_adherence=Avg(Coalesce("predicted_adherence", "adherence_score")))
            )

            for entry in adherence_avgs:
                value = entry.get("avg_adherence")
                if value is None:
                    continue
                if value < 0.5:
                    factor = 0.8
                elif value < 0.7:
                    factor = 0.9
                elif value < 0.85:
                    factor = 1.0
                else:
                    factor = 1.1
                adherence_factors[entry["course_name"]] = factor

        if adherence_factors:
            allocations = apply_adherence_adjustments(
                allocations,
                data["total_available_hours"],
                adherence_factors,
            )

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

