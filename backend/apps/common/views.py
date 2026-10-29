from django.http import JsonResponse
from django.views.decorators.http import require_safe


@require_safe
def health(request):
    """Liveness check for the host. No auth, no throttling and no database query, so it stays cheap."""
    return JsonResponse({"status": "ok"})
