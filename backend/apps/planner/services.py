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
