"""The engine's only database access: one course's data, gathered into a CourseData."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.common import clock
from apps.common.clock import zone_for
from apps.planner.models import Course, StudyPlan
from apps.tracking.inference import forecast_from_points, session_points, weekly_summaries
from apps.tracking.models import StudySessionLog

from ..models import StrategyRating

from .diagnostics import (
    EVIDENCE_WINDOW_DAYS,
    CourseData,
    CourseTraits,
    ForecastInfo,
    PlanInfo,
    RatingInfo,
    SessionRecord,
    WeekRecord,
)


def local_today(now: datetime | None = None, zone: ZoneInfo | None = None) -> date:
    """The day of `now` (default: now) in `zone`, which defines every day and week boundary here.

    Without a zone it is settings.TIME_ZONE.
    """
    return clock.today(zone or clock.default_zone(), now)


def week_start(today: date) -> date:
    return clock.monday_of(today)


def course_traits(course: Course) -> CourseTraits:
    return CourseTraits(
        id=course.id,
        name=course.name,
        difficulty=int(course.difficulty),
        learning_demands=tuple(course.learning_demands or ()),
        builds_on_earlier=course.builds_on_earlier,
        assessment_format=course.assessment_format or "",
        exam_date=course.exam_date,
    )


def _plan_info(
    user, course_name: str, today: date, logs: list[StudySessionLog], zone: ZoneInfo
) -> PlanInfo | None:
    monday = week_start(today)
    key = course_name.casefold()
    plan = StudyPlan.objects.filter(user=user, week_start=monday, is_current=True).first()
    if plan is None:
        return None
    plan_json = plan.plan_json or {}
    # v2 plans list courses with planned_hours and entered_on; legacy plans only have allocations
    # and are paced from Monday.
    for entry in plan_json.get("courses", []):
        if str(entry.get("name", "")).casefold() == key:
            allocated = float(entry.get("planned_hours") or 0.0)
            entered_on = min(max(_entry_date(entry.get("entered_on"), monday), monday), today)
            return PlanInfo(allocated, _logged_hours(logs, monday, zone), entered_on)
    for allocation in plan_json.get("allocations", []):
        if str(allocation.get("course", "")).casefold() == key:
            return PlanInfo(float(allocation.get("allocated_hours") or 0.0), _logged_hours(logs, monday, zone), monday)
    return None


def _entry_date(value, fallback: date) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return fallback


def _logged_hours(logs: list[StudySessionLog], since: date, zone: ZoneInfo) -> float:
    return sum(log.actual_minutes for log in logs if clock.local_date(log.created_at, zone) >= since) / 60


def _ratings(user, course: Course, zone: ZoneInfo) -> dict[str, RatingInfo]:
    rows = StrategyRating.objects.filter(user=user, course=course, cleared_at__isnull=True)
    return {row.strategy_id: RatingInfo(row.value, clock.local_date(row.rated_at, zone)) for row in rows}


def gather_course_data(user, course: Course, now: datetime | None = None, zone: ZoneInfo | None = None) -> CourseData:
    """One course's data as of `now`, with days in `zone` (else the user's)."""
    now = now or timezone.now()
    zone = zone or zone_for(user)
    today = clock.today(zone, now)
    logs = list(
        StudySessionLog.objects.filter(user=user, course_name__iexact=course.name, created_at__lte=now).order_by(
            "created_at", "id"
        )
    )
    window_start = today - timedelta(days=EVIDENCE_WINDOW_DAYS - 1)
    sessions = tuple(
        SessionRecord(
            day=day,
            planned_minutes=int(log.planned_minutes),
            actual_minutes=int(log.actual_minutes),
            focus_score=float(log.focus_score),
            completion_rate=float(log.completion_rate),
            adherence=min(max(float(log.adherence_score), 0.0), 1.0),
        )
        for log in logs
        if (day := clock.local_date(log.created_at, zone)) >= window_start
    )
    points = session_points(logs, zone)
    weeks = tuple(WeekRecord(w.adherence, w.active_days) for w in weekly_summaries(points, today))
    forecast = forecast_from_points(points, today)
    return CourseData(
        course=course_traits(course),
        today=today,
        sessions=sessions,
        total_sessions=len(logs),
        weeks=weeks,
        forecast=ForecastInfo(forecast.status, forecast.predicted_adherence, forecast.weeks_history),
        plan=_plan_info(user, course.name, today, logs, zone),
        ratings=_ratings(user, course, zone),
    )
