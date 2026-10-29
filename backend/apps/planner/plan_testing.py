"""Helpers for tests that need a saved weekly plan: the PUT /api/planner/plans/<week_start>/ calls."""

from .weekly import monday_of, server_today


def this_week_url() -> str:
    return f"/api/planner/plans/{monday_of(server_today()).isoformat()}/"


def first_plan(client, courses, total_hours=10, url=None):
    """PUT this week's first plan: a weekly total split across the courses by difficulty."""
    return client.put(url or this_week_url(), {"courses": courses, "total_hours": total_hours}, format="json")


def plan_update(client, courses, more_hours, base_revision, url=None):
    """PUT the next revision of this week's plan: `more_hours` on top of what is already logged."""
    return client.put(
        url or this_week_url(),
        {"courses": courses, "more_hours": more_hours, "base_revision": base_revision},
        format="json",
    )


def allocations(response):
    """The first-version allocations kept inside a saved plan's plan_json."""
    return response.data["plan_json"]["allocations"]
