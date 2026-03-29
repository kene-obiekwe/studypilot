from django.urls import path

from .views import RecommendationView

urlpatterns = [
    path("generate/", RecommendationView.as_view(), name="generate-recommendations"),
]
