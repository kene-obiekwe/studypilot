"""Diagnostics + course traits -> at most four structured recommendations for one course.

Slots: at most 1 exam strategy, at most 2 behaviour strategies (schedule, habit, focus), and
techniques fill the rest (at least one unless everything fitting is resting). Duplicate strategies
merge; ties fall back to library order so the output is deterministic.

The user's ratings act here: a strategy marked not helpful rests for REST_DAYS and the next fitting
one takes its place, and within each group helpful ones go ahead of unrated ones.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from statistics import mean

from .diagnostics import (
    CourseData,
    EVIDENCE_WINDOW_DAYS,
    Diagnostic,
    RatingInfo,
    evidence_weeks,
    exam_in_days,
    has_history,
    run_diagnostics,
)
from .library import (
    BEHAVIOUR_KINDS,
    DEFAULT_TECHNIQUES,
    DEMAND_LABELS,
    DEMAND_TECHNIQUES,
    EXAM,
    LIBRARY,
    LIBRARY_ORDER,
    TECHNIQUE,
    WARMUP_STEP,
)

MAX_RECOMMENDATIONS = 4
MAX_EXAM = 1
MAX_BEHAVIOUR = 2

DIFFICULT_COURSE = 4
DIFFICULT_BLOCK_MINUTES = 30
DEFAULT_BLOCK_MINUTES = 45

DIAGNOSTIC_STRATEGY = {
    "exam_imminent": "mock_exam",
    "exam_soon": "format_matched_practice",
    "long_sessions_finish_poorly": "split_long_sessions",
    "low_adherence": "right_size_plans",
    "declining_trend": "implementation_intentions",
    "low_forecast": "implementation_intentions",
    "under_studied": "implementation_intentions",
    "sparse_spacing": "spaced_schedule",
    "low_focus": "phone_out_of_room",
}
PRIORITY = {
    "exam_imminent": 10,
    "exam_soon": 20,
    "continuous_quizzes": 25,
    "long_sessions_finish_poorly": 30,
    "low_adherence": 35,
    "declining_trend": 40,
    "low_forecast": 42,
    "under_studied": 45,
    "sparse_spacing": 50,
    "low_focus": 55,
}
TECHNIQUE_PRIORITY_BASE = 60
FALLBACK_PRIORITY = 70

# Strategy ratings (values match StrategyRating.value).
RATING_HELPFUL = "helpful"
RATING_NOT_HELPFUL = "not_helpful"
REST_DAYS = 28

HISTORY = "history"
SETTINGS = "settings"


@dataclass
class Candidate:
    strategy_id: str
    priority: int
    why: str
    basis: str
    triggers: list[str] = field(default_factory=list)
    facts: dict = field(default_factory=dict)
    variant: str = "default"
    extra_steps: list[str] = field(default_factory=list)

    @property
    def kind(self) -> str:
        return LIBRARY[self.strategy_id].kind

    def sort_key(self) -> tuple[int, int]:
        return self.priority, LIBRARY_ORDER[self.strategy_id]


def block_minutes(difficulty: int) -> int:
    return DIFFICULT_BLOCK_MINUTES if difficulty >= DIFFICULT_COURSE else DEFAULT_BLOCK_MINUTES


# -- candidates from diagnostics ------------------------------------------------------


def diagnostic_candidates(data: CourseData, diagnostics: list[Diagnostic]) -> list[Candidate]:
    """One candidate per strategy; a strategy several diagnostics point to merges into one."""
    by_strategy: dict[str, Candidate] = {}
    for diagnostic in sorted(diagnostics, key=lambda d: PRIORITY.get(d.id, 999)):
        strategy_id = DIAGNOSTIC_STRATEGY.get(diagnostic.id)
        if strategy_id is None:
            continue
        basis = HISTORY if diagnostic.history_based else SETTINGS
        existing = by_strategy.get(strategy_id)
        if existing is None:
            by_strategy[strategy_id] = Candidate(
                strategy_id,
                PRIORITY[diagnostic.id],
                diagnostic.why,
                basis,
                triggers=[diagnostic.id],
                facts=dict(diagnostic.facts),
                variant=data.course.assessment_format or "default",
            )
        else:
            # Highest-priority trigger keeps its "why"; later triggers only add facts.
            existing.triggers.append(diagnostic.id)
            existing.facts = {**diagnostic.facts, **existing.facts}
            if basis == HISTORY:
                existing.basis = HISTORY

    course = data.course
    if course.assessment_format == "continuous_quizzes":
        quiz = by_strategy.get("format_matched_practice")
        if quiz is None:
            by_strategy["format_matched_practice"] = Candidate(
                "format_matched_practice",
                PRIORITY["continuous_quizzes"],
                f"{course.name} is assessed by continuous quizzes.",
                SETTINGS,
                facts={"assessment_format": course.assessment_format},
                variant="continuous_quizzes",
            )
    return list(by_strategy.values())


# -- candidates from course traits ---------------------------------------------------------


def technique_order(data: CourseData) -> list[tuple[str, str | None]]:
    """(strategy_id, demand that chose it) in priority order, without duplicates."""
    course = data.course
    lists = [(demand, DEMAND_TECHNIQUES[demand]) for demand in course.learning_demands if demand in DEMAND_TECHNIQUES]
    ordered: list[tuple[str, str | None]] = []
    seen: set[str] = set()

    def add(strategy_id: str, demand: str | None) -> None:
        if strategy_id not in seen:
            seen.add(strategy_id)
            ordered.append((strategy_id, demand))

    # Each demand's best technique first, then the warm-up, then the rest round-robin.
    for demand, techniques in lists:
        add(techniques[0], demand)
    if course.builds_on_earlier:
        add("prerequisite_warmup", None)
    depth = max((len(techniques) for _, techniques in lists), default=0)
    for index in range(1, depth):
        for demand, techniques in lists:
            if index < len(techniques):
                add(techniques[index], demand)
    if not lists:
        for strategy_id in DEFAULT_TECHNIQUES:
            add(strategy_id, None)

    if course.difficulty >= DIFFICULT_COURSE and "worked_examples" in seen:
        ordered.sort(key=lambda item: item[0] != "worked_examples")
    return ordered


def _technique_candidate(data: CourseData, strategy_id: str, demand: str | None, rank: int) -> Candidate:
    course = data.course
    facts: dict = {"difficulty": course.difficulty}
    variant = "default"
    if strategy_id == "prerequisite_warmup":
        why = f"{course.name} builds on earlier topics."
        facts["builds_on_earlier"] = True
    elif demand is None:
        why = f"{course.name} has no learning demands set yet, so this is a general-purpose technique."
    elif strategy_id == "worked_examples" and course.difficulty >= DIFFICULT_COURSE:
        why = f"{course.name} is set as problem solving at difficulty {course.difficulty}."
        facts["learning_demand"] = demand
    else:
        why = f"{course.name} is set as needing {DEMAND_LABELS[demand]}."
        facts["learning_demand"] = demand
    if strategy_id == "worked_examples":
        facts["block_minutes"] = block_minutes(course.difficulty)
    if strategy_id == "retrieval_practice":
        variant = {"problem_solving": "problem", "writing": "essay"}.get(demand or "", "default")
    return Candidate(strategy_id, TECHNIQUE_PRIORITY_BASE + rank, why, SETTINGS, facts=facts, variant=variant)


def _fallback_schedule(data: CourseData) -> Candidate:
    return Candidate(
        "spaced_schedule",
        FALLBACK_PRIORITY,
        f"You haven't logged enough {data.course.name} sessions yet, so spreading study across the week "
        "is a safe default.",
        SETTINGS,
        triggers=["insufficient_history"],
        facts={"sessions": len(data.sessions)},
    )


# -- ratings ---------------------------------------------------------------------------------------


def rest_until(rating: RatingInfo) -> date:
    return rating.rated_on + timedelta(days=REST_DAYS)


def is_resting(rating: RatingInfo, today: date) -> bool:
    return rating.value == RATING_NOT_HELPFUL and today < rest_until(rating)


def current_ratings(data: CourseData) -> dict[str, str]:
    """strategy_id -> rating that counts today; a not_helpful older than REST_DAYS counts as none."""
    return {
        strategy_id: rating.value
        for strategy_id, rating in data.ratings.items()
        if rating.value == RATING_HELPFUL or is_resting(rating, data.today)
    }


def resting_strategies(data: CourseData) -> dict[str, date]:
    """strategy_id -> the day it may return, for strategies the user marked not helpful recently."""
    return {
        strategy_id: rest_until(rating)
        for strategy_id, rating in data.ratings.items()
        if is_resting(rating, data.today) and strategy_id in LIBRARY
    }


# -- selection ---------------------------------------------------------------------------------


def select(data: CourseData, diagnostics: list[Diagnostic]) -> list[Candidate]:
    resting = resting_strategies(data).keys()
    helpful = {strategy_id for strategy_id, value in current_ratings(data).items() if value == RATING_HELPFUL}

    def helpful_first(items: list, strategy_id=lambda item: item.strategy_id) -> list:
        # Stable, so each group otherwise keeps today's order.
        return sorted(items, key=lambda item: strategy_id(item) not in helpful)

    candidates = sorted(
        (c for c in diagnostic_candidates(data, diagnostics) if c.strategy_id not in resting), key=Candidate.sort_key
    )
    exam = helpful_first([c for c in candidates if c.kind == EXAM])[:MAX_EXAM]
    behaviour = helpful_first([c for c in candidates if c.kind in BEHAVIOUR_KINDS])[:MAX_BEHAVIOUR]
    if not behaviour and not has_history(data) and "spaced_schedule" not in resting:
        behaviour = [_fallback_schedule(data)]

    taken = {c.strategy_id for c in exam + behaviour}
    slots = MAX_RECOMMENDATIONS - len(exam) - len(behaviour)
    # Ranks come from the full technique order, so a strategy's priority number doesn't move
    # when another one rests or is rated helpful.
    eligible = [
        (rank, strategy_id, demand)
        for rank, (strategy_id, demand) in enumerate(technique_order(data))
        if strategy_id not in taken and strategy_id not in resting and LIBRARY[strategy_id].kind == TECHNIQUE
    ]
    techniques = [
        _technique_candidate(data, strategy_id, demand, rank)
        for rank, strategy_id, demand in helpful_first(eligible, strategy_id=lambda item: item[1])[:slots]
    ]

    # The warm-up is never silently dropped: without its own slot it becomes the first step
    # of the top technique, unless the user has rested it.
    if (
        data.course.builds_on_earlier
        and techniques
        and "prerequisite_warmup" not in resting
        and "prerequisite_warmup" not in {t.strategy_id for t in techniques}
    ):
        top = techniques[0]
        techniques[0] = replace(
            top,
            why=f"{top.why} It builds on earlier topics, so each session starts with a warm-up.",
            facts={**top.facts, "warmup_step": True},
            extra_steps=[WARMUP_STEP],
        )

    return sorted(exam + behaviour + techniques, key=Candidate.sort_key)


# -- rendering -------------------------------------------------------------------------------


def _render_params(data: CourseData, candidate: Candidate) -> dict:
    course = data.course
    params = {"course": course.name, "block": block_minutes(course.difficulty)}
    if candidate.strategy_id == "split_long_sessions":
        long_minutes = candidate.facts["long_minutes"]
        params["long_minutes"] = long_minutes
        params["n_blocks"] = math.ceil(long_minutes / params["block"])
    if candidate.strategy_id == "right_size_plans":
        actual = candidate.facts.get("mean_actual_minutes", 30)
        params["plan_minutes"] = max(15, int(round(actual / 5)) * 5)
    return params


def render(data: CourseData, candidate: Candidate) -> dict:
    technique = LIBRARY[candidate.strategy_id]
    params = _render_params(data, candidate)
    what, how = technique.render(candidate.variant, **params)
    facts = dict(candidate.facts)
    if candidate.strategy_id == "split_long_sessions":
        facts.update(block_minutes=params["block"], n_blocks=params["n_blocks"])
    if candidate.strategy_id == "right_size_plans":
        facts["plan_minutes"] = params["plan_minutes"]
    return {
        "strategy_id": candidate.strategy_id,
        "kind": technique.kind,
        "priority": candidate.priority,
        "basis": candidate.basis,
        "title": technique.title,
        "what": what,
        "how": candidate.extra_steps + how,
        "why": candidate.why,
        "triggers": list(candidate.triggers),
        "facts": facts,
        "source": technique.source.as_dict(),
    }


def _mean(values) -> float | None:
    values = list(values)
    return round(mean(values), 2) if values else None


def _evidence(data: CourseData, diagnostics: list[Diagnostic], recommendations: list[dict]) -> dict:
    sessions = len(data.sessions)
    weeks = evidence_weeks(data)
    if has_history(data):
        basis, summary = HISTORY, f"Based on {sessions} sessions over {weeks} week{'s' if weeks != 1 else ''}"
    elif any(rec["basis"] == HISTORY for rec in recommendations):
        total = data.total_sessions
        basis = HISTORY
        summary = f"Based on {total} session{'s' if total != 1 else ''} logged so far and your course settings"
    else:
        basis, summary = SETTINGS, "Based on your course settings only"
    return {
        "basis": basis,
        "summary": summary,
        "window_days": EVIDENCE_WINDOW_DAYS,
        "sessions": sessions,
        "total_sessions": data.total_sessions,
        "study_days": len({s.day for s in data.sessions}),
        "weeks": weeks,
        "mean_adherence": _mean(s.adherence for s in data.sessions),
        "mean_completion": _mean(s.completion_rate for s in data.sessions),
        "mean_focus": _mean(s.focus_score for s in data.sessions),
        "forecast": {
            "status": data.forecast.status,
            "predicted_adherence": (
                round(data.forecast.predicted_adherence, 2) if data.forecast.predicted_adherence is not None else None
            ),
            "weeks_history": data.forecast.weeks_history,
        },
        "exam_in_days": exam_in_days(data),
        "plan": (
            {"allocated_hours": round(data.plan.allocated_hours, 2), "logged_hours": round(data.plan.logged_hours, 2)}
            if data.plan
            else None
        ),
        "diagnostics": [d.id for d in diagnostics],
    }


def recommend(data: CourseData) -> dict:
    """The full structured output for one course. Pure: no database access."""
    diagnostics = run_diagnostics(data)
    recommendations = [render(data, candidate) for candidate in select(data, diagnostics)]
    course = data.course
    return {
        "course": {
            "id": course.id,
            "name": course.name,
            "difficulty": course.difficulty,
            "learning_demands": list(course.learning_demands),
            "builds_on_earlier": course.builds_on_earlier,
            "assessment_format": course.assessment_format or None,
            "exam_date": course.exam_date.isoformat() if course.exam_date else None,
        },
        "evidence": _evidence(data, diagnostics, recommendations),
        "recommendations": recommendations,
        "resting": [
            {"strategy_id": strategy_id, "title": LIBRARY[strategy_id].title, "until": until.isoformat()}
            for strategy_id, until in sorted(
                resting_strategies(data).items(), key=lambda item: (item[1], LIBRARY_ORDER[item[0]])
            )
        ],
    }
