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


def generate_plan(total_available_hours: float, courses: List[Dict]) -> List[Dict]:
    total_weight = sum(float(item["difficulty"]) for item in courses)

    allocations: List[Dict] = []
    for course in courses:
        weight = float(course["difficulty"])
        allocated = round((weight / total_weight) * total_available_hours, 2)
        allocations.append(
            {
                "course": course["name"],
                "allocated_hours": allocated,
                "focus_block_minutes": 50,
                "break_minutes": 10,
            }
        )
    return allocations


def apply_adherence_adjustments(
    allocations: List[Dict],
    total_available_hours: float,
    adherence_factors: Dict[str, float],
) -> List[Dict]:
    adjusted: List[Dict] = []
    for item in allocations:
        course = item.get("course", "Unknown")
        base_hours = float(item.get("allocated_hours", 0))
        factor = float(adherence_factors.get(course, 1.0))
        updated = {**item}
        updated["base_hours"] = base_hours
        updated["adherence_factor"] = round(factor, 2)
        updated["allocated_hours"] = base_hours * factor
        adjusted.append(updated)

    total_adjusted = sum(float(item.get("allocated_hours", 0)) for item in adjusted)
    if total_adjusted <= 0:
        return allocations

    scale = float(total_available_hours) / total_adjusted
    for item in adjusted:
        item["allocated_hours"] = round(float(item["allocated_hours"]) * scale, 2)

    return adjusted


def annotate_adjustment_sources(allocations: List[Dict], adjustments: Dict[str, Dict]) -> List[Dict]:
    annotated: List[Dict] = []
    for item in allocations:
        adjustment = adjustments.get(item.get("course", "Unknown"), {})
        annotated.append(
            {
                **item,
                "adjustment_source": adjustment.get("source", ADJUSTMENT_SOURCE_NONE),
                "adherence_estimate": adjustment.get("estimate"),
            }
        )
    return annotated
