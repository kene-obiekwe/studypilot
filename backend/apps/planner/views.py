from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import PlanRequestSerializer, PlanResponseSerializer
from .services import generate_plan


class GeneratePlanView(APIView):
    def post(self, request):
        request_serializer = PlanRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        data = request_serializer.validated_data
        allocations = generate_plan(data["total_available_hours"], data["courses"])

        response_serializer = PlanResponseSerializer(data={"allocations": allocations})
        response_serializer.is_valid(raise_exception=True)
        return Response(response_serializer.data)
