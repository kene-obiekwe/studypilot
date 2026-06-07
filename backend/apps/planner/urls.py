from django.urls import path

from .views import GeneratePlanView, StudyPlanHistoryView

urlpatterns = [
    path("generate/", GeneratePlanView.as_view(), name="generate-plan"),
    path("history/", StudyPlanHistoryView.as_view(), name="study-plan-history"),
]

