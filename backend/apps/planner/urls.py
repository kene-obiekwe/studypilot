from django.urls import path

from .views import CourseDetailView, CourseListCreateView, GeneratePlanView, StudyPlanHistoryView

urlpatterns = [
    path("generate/", GeneratePlanView.as_view(), name="generate-plan"),
    path("history/", StudyPlanHistoryView.as_view(), name="study-plan-history"),
    path("courses/", CourseListCreateView.as_view(), name="course-list"),
    path("courses/<int:pk>/", CourseDetailView.as_view(), name="course-detail"),
]

