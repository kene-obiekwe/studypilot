from django.urls import path

from .views import SessionLogView

urlpatterns = [
    path("session-log/", SessionLogView.as_view(), name="session-log"),
]
