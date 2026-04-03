from django.urls import path

from .views import SessionHistoryView, SessionLogView, TrainingDataView

urlpatterns = [
    path("session-log/", SessionLogView.as_view(), name="session-log"),
    path("history/", SessionHistoryView.as_view(), name="session-history"),
    path("training-data/", TrainingDataView.as_view(), name="training-data"),
]
