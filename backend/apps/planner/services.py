from typing import Dict, List


def generate_plan(total_available_hours: float, courses: List[Dict]) -> List[Dict]:
    total_weight = sum(float(item.get("difficulty", 1)) for item in courses)
    if total_weight <= 0:
        total_weight = float(len(courses))

    allocations: List[Dict] = []
    for course in courses:
        weight = float(course.get("difficulty", 1))
        allocated = round((weight / total_weight) * total_available_hours, 2)
        allocations.append(
            {
                "course": course.get("name", "Unknown"),
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
