from django.urls import path

from .views import (
    CoursePlanView,
    CourseRecommendationsView,
    ShowAgainView,
    StrategyFeedbackView,
)

urlpatterns = [
    path("courses/", CourseRecommendationsView.as_view(), name="course-recommendations"),
    path("courses/<int:pk>/plan/", CoursePlanView.as_view(), name="course-plan"),
    path("feedback/", StrategyFeedbackView.as_view(), name="strategy-feedback"),
    path("show-again/", ShowAgainView.as_view(), name="strategy-show-again"),
]
