from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, StudyPlan
from .serializers import PlanRequestSerializer, PlanResponseSerializer, StudyPlanHistorySerializer
from .services import generate_plan


class GeneratePlanView(APIView):
    def post(self, request):
        request_serializer = PlanRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        data = request_serializer.validated_data
        allocations = generate_plan(data["total_available_hours"], data["courses"])

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
            },
        )

        return Response(response_serializer.data)


class StudyPlanHistoryView(APIView):
    def get(self, request):
        plans = StudyPlan.objects.filter(user=request.user).order_by("-created_at")[:20]
        serializer = StudyPlanHistorySerializer(plans, many=True)
        return Response({"items": serializer.data})

