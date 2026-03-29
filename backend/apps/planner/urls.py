from django.urls import path

from .views import GeneratePlanView

urlpatterns = [
    path("generate/", GeneratePlanView.as_view(), name="generate-plan"),
]
