from typing import List


def get_recommendations(focus_score: float, completion_rate: float, preferred_style: str) -> List[str]:
    strategies: List[str] = []

    if completion_rate < 0.5:
        strategies.append("Use shorter 30-minute sessions with 10-minute breaks.")
        strategies.append("Start each day with one priority topic before other tasks.")

    if focus_score < 0.6:
        strategies.append("Enable distraction-free mode and schedule phone-free study blocks.")

    if preferred_style == "visual":
        strategies.append("Use diagrams and mind maps for revision.")
    elif preferred_style == "reading":
        strategies.append("Use structured summary notes and spaced repetition flashcards.")
    elif preferred_style == "practice":
        strategies.append("Use problem-based practice and timed quizzes.")
    else:
        strategies.append("Combine short videos, notes, and practice questions for each topic.")

    if not strategies:
        strategies.append("Maintain the current routine and review outcomes weekly.")

    return strategies
