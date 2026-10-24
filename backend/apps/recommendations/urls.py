from django.urls import path

from .views import (
    CoursePlanView,
    CourseRecommendationsView,
    RecommendationHistoryView,
    RecommendationView,
    StrategyFeedbackView,
)

urlpatterns = [
    # Legacy slider + style endpoint; removed in 5.3c once the UI uses courses/.
    path("generate/", RecommendationView.as_view(), name="generate-recommendations"),
    path("history/", RecommendationHistoryView.as_view(), name="recommendation-history"),
    path("courses/", CourseRecommendationsView.as_view(), name="course-recommendations"),
    path("courses/<int:pk>/plan/", CoursePlanView.as_view(), name="course-plan"),
    path("feedback/", StrategyFeedbackView.as_view(), name="strategy-feedback"),
]
