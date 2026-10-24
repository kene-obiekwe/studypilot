"""Named patterns detected in one course's data.

Every diagnostic is a pure function of CourseData. It returns a Diagnostic with the numbers
it used (`facts`) and a "why" sentence built from those numbers, or None. Thresholds are
named constants: they are judgement calls for v1, to be revisited with feedback data (7.1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from statistics import mean, median
from typing import Callable

from .library import FORMAT_LABELS

# Evidence window and minimum data.
EVIDENCE_WINDOW_DAYS = 28
MIN_SESSIONS_FOR_HISTORY = 3

# long_sessions_finish_poorly
LONG_SESSION_MINUTES = 90
MIN_SESSIONS_PER_SIDE = 3
FINISH_GAP = 0.20
LONG_FINISH_CEILING = 0.60

# sparse_spacing
MIN_STUDY_DAYS_FOR_SPACING = 3
SPARSE_MEDIAN_GAP_DAYS = 4

# declining_trend and low_forecast
MIN_WEEKS_FOR_TREND = 3
DECLINE_DROP = 0.20
LOW_FORECAST = 0.50

# low_adherence and low_focus
LOW_ADHERENCE = 0.60
LOW_FOCUS = 0.50

# exams
EXAM_SOON_DAYS = 21
EXAM_IMMINENT_DAYS = 7

# under_studied
MIN_DAYS_INTO_WEEK = 3
MIN_EXPECTED_HOURS = 1.0
UNDER_FRACTION = 0.5

# Thresholds marked "at the threshold fires" compare with this tolerance, so float noise such as
# 0.75 - 0.55 = 0.19999... doesn't flip them.
EPSILON = 1e-9

WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


@dataclass(frozen=True)
class SessionRecord:
    day: date
    planned_minutes: int
    actual_minutes: int
    focus_score: float
    completion_rate: float
    adherence: float  # stored adherence_score, clamped to [0, 1]


@dataclass(frozen=True)
class WeekRecord:
    adherence: float | None
    sessions: int  # active days in that complete week


@dataclass(frozen=True)
class ForecastInfo:
    status: str
    predicted_adherence: float | None
    weeks_history: int


@dataclass(frozen=True)
class PlanInfo:
    allocated_hours: float
    logged_hours: float  # this week, up to today


@dataclass(frozen=True)
class CourseTraits:
    id: int | None
    name: str
    difficulty: int
    learning_demands: tuple[str, ...]
    builds_on_earlier: bool | None
    assessment_format: str
    exam_date: date | None


@dataclass(frozen=True)
class CourseData:
    course: CourseTraits
    today: date
    sessions: tuple[SessionRecord, ...]  # within the evidence window
    total_sessions: int  # all time
    weeks: tuple[WeekRecord, ...]  # complete weeks since the first log, oldest first
    forecast: ForecastInfo
    plan: PlanInfo | None


@dataclass(frozen=True)
class Diagnostic:
    id: str
    why: str
    facts: dict
    history_based: bool


def pct(value: float) -> int:
    return int(round(value * 100))


def _number(value: float) -> str:
    """6 -> "6", 6.5 -> "6.5"."""
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def _hours(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def has_history(data: CourseData) -> bool:
    return len(data.sessions) >= MIN_SESSIONS_FOR_HISTORY


# -- diagnostics ---------------------------------------------------------------------


def insufficient_history(data: CourseData) -> Diagnostic | None:
    if has_history(data):
        return None
    return Diagnostic(
        "insufficient_history",
        "",
        {"sessions": len(data.sessions), "min_sessions": MIN_SESSIONS_FOR_HISTORY},
        history_based=False,
    )


def long_sessions_finish_poorly(data: CourseData) -> Diagnostic | None:
    long = [s for s in data.sessions if s.planned_minutes >= LONG_SESSION_MINUTES]
    short = [s for s in data.sessions if s.planned_minutes < LONG_SESSION_MINUTES]
    if len(long) < MIN_SESSIONS_PER_SIDE or len(short) < MIN_SESSIONS_PER_SIDE:
        return None
    long_mean = mean(s.completion_rate for s in long)
    short_mean = mean(s.completion_rate for s in short)
    if short_mean - long_mean < FINISH_GAP - EPSILON or long_mean >= LONG_FINISH_CEILING - EPSILON:
        return None
    return Diagnostic(
        "long_sessions_finish_poorly",
        f"Your {LONG_SESSION_MINUTES}+ minute sessions averaged {pct(long_mean)}% completion "
        f"({len(long)} sessions), against {pct(short_mean)}% for shorter ones ({len(short)}).",
        {
            "long_mean_completion": round(long_mean, 2),
            "short_mean_completion": round(short_mean, 2),
            "n_long": len(long),
            "n_short": len(short),
            "long_minutes": int(round(median(s.planned_minutes for s in long))),
        },
        history_based=True,
    )


def sparse_spacing(data: CourseData) -> Diagnostic | None:
    days = sorted({s.day for s in data.sessions})
    if len(days) < MIN_STUDY_DAYS_FOR_SPACING:
        return None
    gap = median((later - earlier).days for earlier, later in zip(days, days[1:]))
    if gap < SPARSE_MEDIAN_GAP_DAYS:
        return None
    return Diagnostic(
        "sparse_spacing",
        f"You studied {data.course.name} on {len(days)} days in the last 4 weeks, usually "
        f"{_number(gap)} days apart.",
        {"study_days": len(days), "median_gap_days": int(gap) if float(gap).is_integer() else gap},
        history_based=True,
    )


def declining_trend(data: CourseData) -> Diagnostic | None:
    if len(data.weeks) < MIN_WEEKS_FOR_TREND:
        return None
    lag3, lag2, lag1 = data.weeks[-3:]
    if lag1.adherence is None or lag2.adherence is None or lag3.adherence is None:
        return None
    previous = (lag2.adherence + lag3.adherence) / 2
    if lag1.adherence > previous - DECLINE_DROP + EPSILON:
        return None
    if lag1.sessions == 0:
        why = (
            f"You didn't log any {data.course.name} sessions last week, after averaging "
            f"{pct(previous)}% of your plan in the two weeks before."
        )
    else:
        why = (
            f"Your weekly adherence for {data.course.name} dropped from {pct(previous)}% to "
            f"{pct(lag1.adherence)}% last week."
        )
    return Diagnostic(
        "declining_trend",
        why,
        {
            "previous_adherence": round(previous, 2),
            "last_adherence": round(lag1.adherence, 2),
            "last_week_sessions": lag1.sessions,
        },
        history_based=True,
    )


def low_forecast(data: CourseData) -> Diagnostic | None:
    forecast = data.forecast
    if forecast.status != "ok" or forecast.predicted_adherence is None:
        return None
    if forecast.predicted_adherence >= LOW_FORECAST:
        return None
    return Diagnostic(
        "low_forecast",
        f"Based on your last {forecast.weeks_history} weeks, you're on course for about "
        f"{pct(forecast.predicted_adherence)}% of your plan this week.",
        {"predicted_adherence": round(forecast.predicted_adherence, 2), "weeks_history": forecast.weeks_history},
        history_based=True,
    )


def low_adherence(data: CourseData) -> Diagnostic | None:
    if not has_history(data):
        return None
    value = mean(s.adherence for s in data.sessions)
    if value >= LOW_ADHERENCE:
        return None
    return Diagnostic(
        "low_adherence",
        f"In your last {len(data.sessions)} sessions you studied {pct(value)}% of the minutes you planned.",
        {
            "mean_adherence": round(value, 2),
            "sessions": len(data.sessions),
            "mean_actual_minutes": int(round(mean(s.actual_minutes for s in data.sessions))),
        },
        history_based=True,
    )


def low_focus(data: CourseData) -> Diagnostic | None:
    if not has_history(data):
        return None
    value = mean(s.focus_score for s in data.sessions)
    if value >= LOW_FOCUS:
        return None
    return Diagnostic(
        "low_focus",
        f"You rated your focus {pct(value)}% on average across {len(data.sessions)} sessions.",
        {"mean_focus": round(value, 2), "sessions": len(data.sessions)},
        history_based=True,
    )


def exam_in_days(data: CourseData) -> int | None:
    if data.course.exam_date is None:
        return None
    days = (data.course.exam_date - data.today).days
    return days if days >= 0 else None


def _exam_sentence(days: int, assessment_format: str) -> str:
    if days == 0:
        return "Your exam is today."
    when = f"in {_plural(days, 'day')}"
    if assessment_format == "coursework":
        return f"Your coursework is due {when}."
    label = FORMAT_LABELS.get(assessment_format)
    if label and assessment_format != "continuous_quizzes":
        article = "an" if label[0] in "aeiou" else "a"
        return f"Your exam is {when} and it's {article} {label}."
    return f"Your exam is {when}."


def exam_soon(data: CourseData) -> Diagnostic | None:
    days = exam_in_days(data)
    if days is None or not EXAM_IMMINENT_DAYS < days <= EXAM_SOON_DAYS:
        return None
    return Diagnostic(
        "exam_soon",
        _exam_sentence(days, data.course.assessment_format),
        {"exam_in_days": days, "assessment_format": data.course.assessment_format or None},
        history_based=False,
    )


def exam_imminent(data: CourseData) -> Diagnostic | None:
    days = exam_in_days(data)
    if days is None or days > EXAM_IMMINENT_DAYS:
        return None
    return Diagnostic(
        "exam_imminent",
        _exam_sentence(days, data.course.assessment_format),
        {"exam_in_days": days, "assessment_format": data.course.assessment_format or None},
        history_based=False,
    )


def under_studied(data: CourseData) -> Diagnostic | None:
    if data.plan is None:
        return None
    elapsed = data.today.weekday() + 1  # Monday = 1
    expected = data.plan.allocated_hours * elapsed / 7
    if elapsed < MIN_DAYS_INTO_WEEK or expected < MIN_EXPECTED_HOURS:
        return None
    if data.plan.logged_hours >= UNDER_FRACTION * expected:
        return None
    return Diagnostic(
        "under_studied",
        f"This week's plan gives {data.course.name} {_hours(data.plan.allocated_hours)} h. By "
        f"{WEEKDAY_NAMES[data.today.weekday()]} you've logged {_hours(data.plan.logged_hours)} h, against "
        f"about {_hours(expected)} h to be on track.",
        {
            "allocated_hours": round(data.plan.allocated_hours, 2),
            "logged_hours": round(data.plan.logged_hours, 2),
            "expected_hours": round(expected, 2),
            "days_into_week": elapsed,
        },
        history_based=True,
    )


DIAGNOSTICS: tuple[Callable[[CourseData], Diagnostic | None], ...] = (
    insufficient_history,
    exam_imminent,
    exam_soon,
    long_sessions_finish_poorly,
    low_adherence,
    declining_trend,
    low_forecast,
    under_studied,
    sparse_spacing,
    low_focus,
)


def run_diagnostics(data: CourseData) -> list[Diagnostic]:
    return [result for check in DIAGNOSTICS if (result := check(data)) is not None]


def evidence_weeks(data: CourseData) -> int:
    """Weeks covered by the windowed sessions (1-4), for the evidence summary."""
    if not data.sessions:
        return 0
    span = (data.today - min(s.day for s in data.sessions)).days + 1
    return max(1, min(EVIDENCE_WINDOW_DAYS // 7, math.ceil(span / 7)))
