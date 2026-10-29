from django.urls import path

from .views import (
    CourseDetailView,
    CourseListCreateView,
    SuggestTraitsView,
    WeeklyPlanDetailView,
    WeeklyPlanListView,
    WeeklyPlanPreviewView,
)

urlpatterns = [
    path("plans/", WeeklyPlanListView.as_view(), name="weekly-plan-list"),
    path("plans/preview/", WeeklyPlanPreviewView.as_view(), name="weekly-plan-preview"),
    path("plans/<str:week_start>/", WeeklyPlanDetailView.as_view(), name="weekly-plan-detail"),
    path("courses/", CourseListCreateView.as_view(), name="course-list"),
    path("courses/suggest-traits/", SuggestTraitsView.as_view(), name="course-suggest-traits"),
    path("courses/<int:pk>/", CourseDetailView.as_view(), name="course-detail"),
]
