from django.contrib import admin
from django.urls import include, path

from apps.common.views import health
from apps.users.views import (
    ThrottledTokenBlacklistView,
    ThrottledTokenObtainPairView,
    ThrottledTokenRefreshView,
)

urlpatterns = [
    path("api/health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", ThrottledTokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/token/blacklist/", ThrottledTokenBlacklistView.as_view(), name="token_blacklist"),
    path("api/users/", include("apps.users.urls")),
    path("api/planner/", include("apps.planner.urls")),
    path("api/recommendations/", include("apps.recommendations.urls")),
    path("api/tracking/", include("apps.tracking.urls")),
]
