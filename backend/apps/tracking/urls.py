from django.urls import path

from .views import AdherencePredictionView, SessionHistoryView, SessionLogView, TrainingDataView

urlpatterns = [
    path("session-log/", SessionLogView.as_view(), name="session-log"),
    path("predict/", AdherencePredictionView.as_view(), name="adherence-predict"),
    path("history/", SessionHistoryView.as_view(), name="session-history"),
    path("training-data/", TrainingDataView.as_view(), name="training-data"),
]
