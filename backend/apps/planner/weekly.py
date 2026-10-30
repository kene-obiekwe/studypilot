"""This week's plan: one current revision per user and week, built with the catch-up split.

A week runs Monday to Sunday and is named by its Monday (week_start). Days and weeks here are the
user's: Monday 00:00 to the next Monday 00:00 in their time zone (apps.common.clock; UTC until one is
set). The client names the week it means, which must be this week or next (see validate_week_start).

plan_json version 2, per revision:
    version, mode ("first" | "update" | "course_deleted"), made_on, total_hours, more_hours,
    counted_hours, clamped,
    courses: [{course_id, name, difficulty, factor, adjustment_source, adherence_estimate,
               entered_on, logged_at_revision, remaining_at_revision, planned_hours,
               focus_block_minutes, break_minutes}],
    removed: [{course_id, name, removed_on, logged_hours}],
and, for readers of the first version, total_available_hours (= total_hours) and allocations
(allocated_hours = planned_hours).

Hours "counted" this week are the hours logged on courses in the current plan. Logs on other
courses (removed, or never planned) stay in history but don't count toward the week's total.
Logs belong to a course by name, so a course removed and added back gets its logs back.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.db.models import Avg, FloatField, Value
from django.db.models.functions import Greatest, Least
from django.utils import timezone

from apps.common import clock
from apps.common.clock import monday_of, zone_for
from apps.tracking.inference import STATUS_OK, forecast_course
from apps.tracking.models import StudySessionLog

from .models import Course, StudyPlan
from .services import ADJUSTMENT_SOURCE_NONE, catch_up_split, resolve_adjustment

PLAN_VERSION = 2
MAX_WEEK_HOURS = 168
FOCUS_BLOCK_MINUTES = 50
BREAK_MINUTES = 10

MODE_FIRST = "first"
MODE_UPDATE = "update"
MODE_COURSE_DELETED = "course_deleted"

ZERO = Value(0.0, output_field=FloatField())
ONE = Value(1.0, output_field=FloatField())


class PlanConflict(Exception):
    """The plan changed since the client read it ("plan_changed"), or already exists ("plan_exists")."""

    def __init__(self, code: str, current: StudyPlan | None):
        super().__init__(code)
        self.code = code
        self.current = current


class PlanInputError(Exception):
    """A request the split can't satisfy, reported as a 400 on `field`."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


# -- Weeks -------------------------------------------------------------------------------------


def server_today(now: datetime | None = None, zone: ZoneInfo | None = None) -> date:
    """Today in `zone` (settings.TIME_ZONE when not given)."""
    return clock.today(zone or clock.default_zone(), now)


def validate_week_start(week_start: date, today: date) -> str | None:
    """None when the client may plan this week; otherwise the reason it can't.

    `today` is the user's. The week must be this week or next week, with a day's slack either side
    of today so a stale tab in another zone or a skewed clock can still save. Last week is
    accepted only in the first day of a week.
    """
    if week_start.weekday() != 0:
        return "week_start must be a Monday."
    allowed = set()
    for day in (today - timedelta(days=1), today, today + timedelta(days=1)):
        allowed.update((monday_of(day), monday_of(day) + timedelta(days=7)))
    if week_start not in allowed:
        return "You can plan this week or next week only."
    return None


def days_left(week_start: date, today: date) -> int:
    """Days left in the week including today: 7 for a week that hasn't started, 0 once it's over."""
    end = week_start + timedelta(days=6)
    if today < week_start:
        return 7
    return max(0, (end - today).days + 1)


def week_bounds(week_start: date, zone: ZoneInfo | None = None) -> tuple[datetime, datetime]:
    """Monday 00:00 to the next Monday 00:00 in `zone` (settings.TIME_ZONE when not given)."""
    return clock.week_bounds(week_start, zone or clock.default_zone())


def logged_hours_by_name(user, week_start: date, now: datetime, zone: ZoneInfo | None = None) -> dict[str, float]:
    """Hours logged in the week up to now, keyed by casefolded course name. The week is in `zone`, else the user's."""
    start, end = week_bounds(week_start, zone or zone_for(user))
    totals: dict[str, float] = {}
    logs = StudySessionLog.objects.filter(user=user, created_at__gte=start, created_at__lt=end, created_at__lte=now)
    for name, minutes in logs.values_list("course_name", "actual_minutes"):
        if minutes and minutes > 0:
            key = name.casefold()
            totals[key] = totals.get(key, 0.0) + minutes / 60
    return totals


# -- Adherence adjustments (as the planner has always weighted courses) -------------------------


def adherence_adjustments(user, names: list[str], now: datetime, zone: ZoneInfo | None = None) -> dict[str, dict]:
    """Per course name: the forecast, else the 30-day observed mean, else no adjustment."""
    adjustments: dict[str, dict] = {}
    for name in names:
        mean = StudySessionLog.objects.filter(
            user=user,
            course_name__iexact=name,
            created_at__gte=now - timedelta(days=30),
        ).aggregate(
            # Logs written before adherence was capped at log time can exceed 1.
            avg_adherence=Avg(Least(Greatest("adherence_score", ZERO), ONE))
        )["avg_adherence"]
        forecast = forecast_course(user, name, now=now, zone=zone)
        forecast_value = forecast.predicted_adherence if forecast.status == STATUS_OK else None
        adjustments[name] = resolve_adjustment(forecast_value, mean)
    return adjustments


# -- Reading plans ------------------------------------------------------------------------------


def current_plan(user, week_start: date, *, lock: bool = False) -> StudyPlan | None:
    plans = StudyPlan.objects.filter(user=user, week_start=week_start, is_current=True)
    if lock:
        plans = plans.select_for_update()
    return plans.first()


def plan_entries(plan: StudyPlan | None) -> list[dict]:
    """The plan's course entries in the version-2 shape, converting a first-version plan on the fly.

    A first-version plan has only allocations: each becomes an entry that entered on the week's
    Monday with nothing logged at revision time, so planned = its allocated hours.
    """
    if plan is None:
        return []
    data = plan.plan_json or {}
    if data.get("version") == PLAN_VERSION:
        return [dict(entry) for entry in data.get("courses", [])]
    difficulties = {
        str(course.get("name", "")).casefold(): course.get("difficulty") for course in data.get("courses", []) or []
    }
    entries = []
    for allocation in data.get("allocations", []) or []:
        name = str(allocation.get("course", ""))
        if not name:
            continue
        hours = float(allocation.get("allocated_hours") or 0.0)
        entries.append(
            {
                "course_id": None,
                "name": name,
                "difficulty": difficulties.get(name.casefold()) or 3,
                "factor": float(allocation.get("adherence_factor") or 1.0),
                "adjustment_source": allocation.get("adjustment_source", ADJUSTMENT_SOURCE_NONE),
                "adherence_estimate": allocation.get("adherence_estimate"),
                "entered_on": plan.week_start.isoformat(),
                "logged_at_revision": 0.0,
                "remaining_at_revision": hours,
                "planned_hours": hours,
                "focus_block_minutes": allocation.get("focus_block_minutes", FOCUS_BLOCK_MINUTES),
                "break_minutes": allocation.get("break_minutes", BREAK_MINUTES),
            }
        )
    return entries


def plan_removed(plan: StudyPlan | None) -> list[dict]:
    if plan is None:
        return []
    data = plan.plan_json or {}
    return [dict(item) for item in data.get("removed", [])] if data.get("version") == PLAN_VERSION else []


# -- Building a revision ------------------------------------------------------------------------


@dataclass
class Revision:
    week_start: date
    plan_json: dict
    days_left: int


def _legacy_allocations(entries: list[dict], *, with_factors: bool) -> list[dict]:
    allocations = []
    for entry in entries:
        allocation = {
            "course": entry["name"],
            "allocated_hours": entry["planned_hours"],
            "focus_block_minutes": entry["focus_block_minutes"],
            "break_minutes": entry["break_minutes"],
        }
        if with_factors:
            allocation["base_hours"] = entry.get("base_hours", entry["planned_hours"])
            allocation["adherence_factor"] = round(float(entry["factor"]), 2)
        allocation["adjustment_source"] = entry["adjustment_source"]
        allocation["adherence_estimate"] = entry["adherence_estimate"]
        allocations.append(allocation)
    return allocations


def compose_plan_json(
    *,
    mode: str,
    made_on: date,
    entries: list[dict],
    removed: list[dict],
    more_hours: float,
    clamped: bool,
) -> dict:
    """The stored version-2 plan, plus the first-version fields older readers still use."""
    counted = round(sum(entry["logged_at_revision"] for entry in entries), 2)
    total = round(sum(entry["planned_hours"] for entry in entries), 2)
    with_factors = any(entry["adjustment_source"] != ADJUSTMENT_SOURCE_NONE for entry in entries)
    stored_entries = [{key: value for key, value in entry.items() if key != "base_hours"} for entry in entries]
    return {
        "version": PLAN_VERSION,
        "mode": mode,
        "made_on": made_on.isoformat(),
        "total_hours": total,
        "more_hours": round(more_hours, 2),
        "counted_hours": counted,
        "clamped": clamped,
        "courses": stored_entries,
        "removed": removed,
        "total_available_hours": total,
        "allocations": _legacy_allocations(entries, with_factors=with_factors),
        # A plan's adjustments, by course, as the first version stored them.
        "adherence_adjustments": (
            {entry["name"]: entry["factor"] for entry in entries if entry["adjustment_source"] != ADJUSTMENT_SOURCE_NONE}
        ),
    }


def canonical_courses(user, courses: list[dict]) -> list[dict]:
    """Requested courses with each existing course's stored name and id (None for new names)."""
    stored: dict[str, Course] = {}
    for existing in Course.objects.filter(user=user).order_by("id"):
        stored.setdefault(existing.name.casefold(), existing)
    result = []
    for course in courses:
        match = stored.get(course["name"].strip().casefold())
        result.append(
            {
                "course_id": match.id if match else None,
                "name": match.name if match else course["name"].strip(),
                "difficulty": int(course["difficulty"]),
            }
        )
    return result


def build_revision(
    user,
    week_start: date,
    courses: list[dict],
    *,
    total_hours: float | None = None,
    more_hours: float | None = None,
    previous: StudyPlan | None,
    now: datetime | None = None,
    zone: ZoneInfo | None = None,
) -> Revision:
    """Compute (without saving) the next revision of a week's plan.

    Give total_hours for a first plan (more = total - counted, never below 0: `clamped` when the
    total was below the hours already counted) or more_hours for an update. Days are in `zone`,
    else the user's.
    """
    now = now or timezone.now()
    zone = zone or zone_for(user)
    today = server_today(now, zone)
    entered_today = min(max(today, week_start), week_start + timedelta(days=6))
    requested = canonical_courses(user, courses)
    logged = logged_hours_by_name(user, week_start, now, zone)
    counted = sum(logged.get(course["name"].casefold(), 0.0) for course in requested)

    clamped = False
    if total_hours is not None:
        more = float(total_hours) - counted
        if more < 0:
            more, clamped = 0.0, True
    else:
        more = float(more_hours or 0.0)
    if counted + more > MAX_WEEK_HOURS + 1e-9:
        field = "total_hours" if total_hours is not None else "more_hours"
        raise PlanInputError(field, f"A week can hold at most {MAX_WEEK_HOURS} hours, including the hours already done.")

    adjustments = adherence_adjustments(user, [course["name"] for course in requested], now, zone)
    split_input = [
        {
            "name": course["name"],
            "difficulty": course["difficulty"],
            "factor": adjustments[course["name"]]["factor"],
            "logged": logged.get(course["name"].casefold(), 0.0),
        }
        for course in requested
    ]
    split = catch_up_split(more, split_input)

    previous_entries = {entry["name"].casefold(): entry for entry in plan_entries(previous)}
    total_difficulty = sum(course["difficulty"] for course in requested)
    base = round(more, 2) + counted
    entries = []
    for course, item, shares in zip(requested, split_input, split):
        before = previous_entries.get(course["name"].casefold())
        adjustment = adjustments[course["name"]]
        entries.append(
            {
                "course_id": course["course_id"],
                "name": course["name"],
                "difficulty": course["difficulty"],
                "factor": adjustment["factor"],
                "adjustment_source": adjustment["source"],
                "adherence_estimate": adjustment["estimate"],
                "entered_on": before["entered_on"] if before else entered_today.isoformat(),
                "logged_at_revision": round(item["logged"], 2),
                "remaining_at_revision": shares["remaining_hours"],
                "planned_hours": shares["planned_hours"],
                "focus_block_minutes": FOCUS_BLOCK_MINUTES,
                "break_minutes": BREAK_MINUTES,
                # Only for the first-version allocations: the share before the adherence factor.
                "base_hours": round(course["difficulty"] / total_difficulty * base, 2),
            }
        )

    kept = {course["name"].casefold() for course in requested}
    removed = [item for item in plan_removed(previous) if item["name"].casefold() not in kept]
    already_removed = {item["name"].casefold() for item in removed}
    for key, entry in previous_entries.items():
        if key not in kept and key not in already_removed:
            removed.append(
                {
                    "course_id": entry.get("course_id"),
                    "name": entry["name"],
                    "removed_on": today.isoformat(),
                    "logged_hours": round(logged.get(key, 0.0), 2),
                }
            )
    for item in removed:
        item["logged_hours"] = round(logged.get(item["name"].casefold(), 0.0), 2)

    plan_json = compose_plan_json(
        mode=MODE_UPDATE if previous is not None else MODE_FIRST,
        made_on=today,
        entries=entries,
        removed=removed,
        more_hours=more,
        clamped=clamped,
    )
    return Revision(week_start=week_start, plan_json=plan_json, days_left=days_left(week_start, today))


# -- Saving -------------------------------------------------------------------------------------


def _next_revision_number(user, week_start: date) -> int:
    latest = StudyPlan.objects.filter(user=user, week_start=week_start).order_by("-revision").first()
    return (latest.revision + 1) if latest else 1


def _store(user, week_start: date, plan_json: dict, current: StudyPlan | None, now: datetime) -> StudyPlan:
    """Supersede `current` (if any) and save the next revision. Call inside a transaction."""
    revision = _next_revision_number(user, week_start)
    if current is not None:
        StudyPlan.objects.filter(pk=current.pk).update(is_current=False, superseded_at=now, updated_at=now)
    return StudyPlan.objects.create(
        user=user, week_start=week_start, plan_json=plan_json, revision=revision, is_current=True
    )


def _sync_courses(user, entries: list[dict]) -> None:
    """Create new course names and save each course's difficulty and planned hours, as planning always has.

    A changed difficulty is an edit to the course's settings, so it also moves `updated_at` (which
    outdates the course's written weekly plan). Planned hours belong to the weekly plan, so
    changing them alone leaves `updated_at` as it was.
    """
    for entry in entries:
        fields = {"difficulty": entry["difficulty"], "weekly_target_hours": entry["planned_hours"]}
        course = Course.objects.filter(user=user, pk=entry["course_id"]).first() if entry["course_id"] else None
        if course is None:
            course = Course.objects.create(user=user, name=entry["name"], **fields)
            entry["course_id"] = course.id
        else:
            update_fields = list(fields)
            if course.difficulty != fields["difficulty"]:
                update_fields.append("updated_at")
            for field, value in fields.items():
                setattr(course, field, value)
            course.save(update_fields=update_fields)


def save_revision(
    user,
    week_start: date,
    courses: list[dict],
    *,
    base_revision: int | None,
    total_hours: float | None = None,
    more_hours: float | None = None,
    now: datetime | None = None,
    zone: ZoneInfo | None = None,
) -> tuple[StudyPlan, Revision]:
    """Save the week's first plan or its next revision.

    base_revision None means "first plan" (PlanConflict "plan_exists" if one exists); otherwise it
    must be the current revision (PlanConflict "plan_changed").
    """
    now = now or timezone.now()
    try:
        with transaction.atomic():
            current = current_plan(user, week_start, lock=True)
            if base_revision is None and current is not None:
                raise PlanConflict("plan_exists", current)
            if base_revision is not None and (current is None or current.revision != base_revision):
                raise PlanConflict("plan_changed", current)
            revision = build_revision(
                user,
                week_start,
                courses,
                total_hours=total_hours,
                more_hours=more_hours,
                previous=current,
                now=now,
                zone=zone,
            )
            _sync_courses(user, revision.plan_json["courses"])
            plan = _store(user, week_start, revision.plan_json, current, now)
    except IntegrityError:
        # Another request saved this week's plan between our read and our write.
        raise PlanConflict("plan_exists" if base_revision is None else "plan_changed", current_plan(user, week_start))
    return plan, revision


# -- Course rename and delete -------------------------------------------------------------------


def _open_plans(user, today: date):
    """Current plans for this week and next week: the ones a course change still affects."""
    return StudyPlan.objects.filter(user=user, is_current=True, week_start__gte=monday_of(today))


def _same_course(entry: dict, course: Course, name: str) -> bool:
    return entry.get("course_id") == course.id or str(entry.get("name", "")).casefold() == name.casefold()


def rename_course_in_plans(
    course: Course, old_name: str, now: datetime | None = None, zone: ZoneInfo | None = None
) -> None:
    """Follow a rename in this week's and next week's current plans (in place: not a new revision).

    The rename also moves the course's logs, so without this the plan would point at a name that
    no longer has any logs or course.
    """
    today = server_today(now, zone or zone_for(course.user))
    for plan in _open_plans(course.user, today):
        data = plan.plan_json or {}
        v2 = data.get("version") == PLAN_VERSION
        changed = False
        # courses: version-2 entries, or the first version's {name, difficulty} list.
        for entry in [*(data.get("courses") or []), *(data.get("removed") or [] if v2 else [])]:
            if _same_course(entry, course, old_name):
                entry["name"] = course.name
                if v2:
                    entry["course_id"] = course.id
                changed = True
        for allocation in data.get("allocations") or []:
            if str(allocation.get("course", "")).casefold() == old_name.casefold():
                allocation["course"] = course.name
                changed = True
        if changed:
            plan.plan_json = data
            plan.save(update_fields=["plan_json", "updated_at"])


def drop_course_from_plans(course: Course, now: datetime | None = None, zone: ZoneInfo | None = None) -> None:
    """A course is being deleted: revise this week's and next week's plans without it.

    Every other course keeps its planned hours (no re-split: that happens only when the user
    updates the plan). The course moves to `removed`, with the hours logged on it this week.
    """
    now = now or timezone.now()
    zone = zone or zone_for(course.user)
    today = server_today(now, zone)
    for plan in _open_plans(course.user, today):
        entries = plan_entries(plan)
        kept = [entry for entry in entries if not _same_course(entry, course, course.name)]
        if len(kept) == len(entries):
            continue
        dropped = next(entry for entry in entries if _same_course(entry, course, course.name))
        logged = logged_hours_by_name(course.user, plan.week_start, now, zone)
        removed = [item for item in plan_removed(plan) if not _same_course(item, course, course.name)]
        removed.append(
            {
                "course_id": course.id,
                "name": dropped["name"],
                "removed_on": today.isoformat(),
                "logged_hours": round(logged.get(dropped["name"].casefold(), 0.0), 2),
            }
        )
        plan_json = compose_plan_json(
            mode=MODE_COURSE_DELETED,
            made_on=today,
            entries=kept,
            removed=removed,
            more_hours=round(sum(entry["remaining_at_revision"] for entry in kept), 2),
            clamped=False,
        )
        _store(course.user, plan.week_start, plan_json, plan, now)


def revision_counts(user, week_starts: list[date]) -> dict[date, int]:
    counts: dict[date, int] = {}
    for week in StudyPlan.objects.filter(user=user, week_start__in=week_starts).values_list("week_start", flat=True):
        counts[week] = counts.get(week, 0) + 1
    return counts
