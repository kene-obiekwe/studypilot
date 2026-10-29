from typing import Dict, List, Optional

ADJUSTMENT_SOURCE_MODEL = "model"
ADJUSTMENT_SOURCE_RULE = "rule"
ADJUSTMENT_SOURCE_NONE = "none"


def adherence_factor(adherence: float) -> float:
    if adherence < 0.5:
        return 0.8
    if adherence < 0.7:
        return 0.9
    if adherence < 0.85:
        return 1.0
    return 1.1


def resolve_adjustment(forecast_value: Optional[float], rule_value: Optional[float]) -> Dict:
    """Prefer the model forecast, then the 30-day observed mean, else no adjustment."""
    if forecast_value is not None:
        source, estimate = ADJUSTMENT_SOURCE_MODEL, float(forecast_value)
    elif rule_value is not None:
        source, estimate = ADJUSTMENT_SOURCE_RULE, float(rule_value)
    else:
        return {"source": ADJUSTMENT_SOURCE_NONE, "estimate": None, "factor": 1.0}
    return {"source": source, "estimate": round(estimate, 4), "factor": adherence_factor(estimate)}


def _to_cents(hours: float) -> int:
    return int(round(float(hours) * 100))


def catch_up_split(more_hours: float, courses: List[Dict]) -> List[Dict]:
    """Share `more_hours` across the plan's courses, catching up on what is already logged.

    Each course is {"name", "difficulty", "factor", "logged"} (logged = hours already logged this
    week). Its weight is difficulty x factor. The fair full-week target is its share of
    (more + all logged hours); the course gets what it still lacks, max(0, target - logged), scaled
    so the shares add up to `more_hours`. A course at or past its share gets 0; with more = 0 every
    course gets 0.

    Remaining hours are whole hundredths that sum to `more_hours` (rounded to 2 dp) exactly: each is
    rounded down and the leftover hundredths go to the largest fractions (largest-remainder), so
    none is ever negative. Returns, per course in input order: target_hours, remaining_hours and
    planned_hours (= logged + remaining).
    """
    more_cents = max(0, _to_cents(more_hours))
    weights = [float(course["difficulty"]) * float(course.get("factor", 1.0)) for course in courses]
    total_weight = sum(weights)
    logged = [max(0.0, float(course.get("logged", 0.0))) for course in courses]
    base = more_cents / 100 + sum(logged)

    targets = [(weight / total_weight) * base if total_weight > 0 else 0.0 for weight in weights]
    raw = [max(0.0, target - done) for target, done in zip(targets, logged)]
    raw_total = sum(raw)

    exact = [(share / raw_total) * more_cents if raw_total > 0 else 0.0 for share in raw]
    cents = [int(value) for value in exact]
    leftover = more_cents - sum(cents) if raw_total > 0 else 0
    by_fraction = sorted(range(len(exact)), key=lambda index: (-(exact[index] - cents[index]), index))
    for index in by_fraction[:leftover]:
        cents[index] += 1

    results: List[Dict] = []
    for course, target, done, share in zip(courses, targets, logged, cents):
        remaining = share / 100
        results.append(
            {
                "name": course["name"],
                "target_hours": round(target, 2),
                "remaining_hours": remaining,
                "planned_hours": round(done + remaining, 2),
            }
        )
    return results
