from django.urls import path

from .views import RecommendationHistoryView, RecommendationView

urlpatterns = [
    path("generate/", RecommendationView.as_view(), name="generate-recommendations"),
    path("history/", RecommendationHistoryView.as_view(), name="recommendation-history"),
]

