from django.urls import path

from .views import (
    CourseDetailView,
    CourseListCreateView,
    GeneratePlanView,
    StudyPlanHistoryView,
    SuggestTraitsView,
    WeeklyPlanDetailView,
    WeeklyPlanListView,
    WeeklyPlanPreviewView,
)

urlpatterns = [
    path("plans/", WeeklyPlanListView.as_view(), name="weekly-plan-list"),
    path("plans/preview/", WeeklyPlanPreviewView.as_view(), name="weekly-plan-preview"),
    path("plans/<str:week_start>/", WeeklyPlanDetailView.as_view(), name="weekly-plan-detail"),
    # First-version endpoints, kept until the frontend uses /plans/.
    path("generate/", GeneratePlanView.as_view(), name="generate-plan"),
    path("history/", StudyPlanHistoryView.as_view(), name="study-plan-history"),
    path("courses/", CourseListCreateView.as_view(), name="course-list"),
    path("courses/suggest-traits/", SuggestTraitsView.as_view(), name="course-suggest-traits"),
    path("courses/<int:pk>/", CourseDetailView.as_view(), name="course-detail"),
]
