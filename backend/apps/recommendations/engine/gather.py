"""The engine's only database access: one course's data, gathered into a CourseData."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.utils import timezone

from apps.planner.models import Course, StudyPlan
from apps.tracking.inference import forecast_from_points, session_points, weekly_summaries
from apps.tracking.models import StudySessionLog

from .diagnostics import (
    EVIDENCE_WINDOW_DAYS,
    CourseData,
    CourseTraits,
    ForecastInfo,
    PlanInfo,
    SessionRecord,
    WeekRecord,
)


def local_today(now: datetime | None = None) -> date:
    """Today in settings.TIME_ZONE, which defines every day and week boundary here."""
    return timezone.localtime(now or timezone.now(), timezone.get_default_timezone()).date()


def week_start(today: date) -> date:
    return today - timedelta(days=today.weekday())


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


def _plan_info(user, course_name: str, today: date, logs: list[StudySessionLog]) -> PlanInfo | None:
    monday = week_start(today)
    key = course_name.casefold()
    for plan in StudyPlan.objects.filter(user=user, week_start=monday).order_by("-created_at", "-id"):
        for allocation in (plan.plan_json or {}).get("allocations", []):
            if str(allocation.get("course", "")).casefold() == key:
                logged_minutes = sum(
                    log.actual_minutes for log in logs if local_today(log.created_at) >= monday
                )
                return PlanInfo(float(allocation.get("allocated_hours") or 0.0), logged_minutes / 60)
    return None


def gather_course_data(user, course: Course, now: datetime | None = None) -> CourseData:
    now = now or timezone.now()
    today = local_today(now)
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
        if (day := local_today(log.created_at)) >= window_start
    )
    points = session_points(logs)
    weeks = tuple(WeekRecord(w.adherence, w.active_days) for w in weekly_summaries(points, today))
    forecast = forecast_from_points(points, today)
    return CourseData(
        course=course_traits(course),
        today=today,
        sessions=sessions,
        total_sessions=len(logs),
        weeks=weeks,
        forecast=ForecastInfo(forecast.status, forecast.predicted_adherence, forecast.weeks_history),
        plan=_plan_info(user, course.name, today, logs),
    )
