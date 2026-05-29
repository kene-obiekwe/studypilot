"""
Seed deterministic pilot demo data for Chapter 4 screenshots and end-to-end demos.

Creates five pilot users with distinct adherence/focus profiles, three courses each,
one study plan, a handful of recommendation logs, and roughly 18 session logs
spread over the last 28 days. Timestamps are backdated so the planner's 30-day
adherence-factor lookup and the progress dashboard's history paging both show
meaningful content immediately.

This is demo data for system validation, NOT real pilot user feedback. Real pilot
feedback is collected separately and remains future work.

Re-running the command is safe: it uses get_or_create for users and courses, and
clears prior plans/recommendations/sessions for the pilot accounts before
re-seeding so the data stays deterministic across runs.

Usage (from backend/):

    python manage.py seed_pilot_data
    python manage.py seed_pilot_data --reset
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.planner.models import Course, StudyPlan
from apps.planner.services import generate_plan
from apps.recommendations.models import RecommendationLog
from apps.recommendations.services import get_recommendations
from apps.tracking.inference import build_feature_payload, predict_adherence
from apps.tracking.models import StudySessionLog


@dataclass(frozen=True)
class PilotProfile:
    username: str
    full_label: str
    preferred_style: str
    adherence_mean: float       # baseline ratio of actual / planned minutes
    adherence_jitter: float     # +- noise applied per session
    focus_mean: float
    completion_mean: float
    sessions_per_week: int      # roughly how many sessions to seed per 7-day window


PILOTS: tuple[PilotProfile, ...] = (
    PilotProfile(
        username="pilot_consistent",
        full_label="Consistent high adherer (visual learner)",
        preferred_style="visual",
        adherence_mean=0.92,
        adherence_jitter=0.08,
        focus_mean=0.82,
        completion_mean=0.84,
        sessions_per_week=5,
    ),
    PilotProfile(
        username="pilot_struggling",
        full_label="Struggling learner (mixed approach)",
        preferred_style="mixed",
        adherence_mean=0.45,
        adherence_jitter=0.15,
        focus_mean=0.40,
        completion_mean=0.42,
        sessions_per_week=3,
    ),
    PilotProfile(
        username="pilot_improving",
        full_label="Improving practice-oriented learner",
        preferred_style="practice",
        adherence_mean=0.70,
        adherence_jitter=0.12,
        focus_mean=0.65,
        completion_mean=0.68,
        sessions_per_week=4,
    ),
    PilotProfile(
        username="pilot_declining",
        full_label="Declining reading-oriented learner",
        preferred_style="reading",
        adherence_mean=0.60,
        adherence_jitter=0.18,
        focus_mean=0.55,
        completion_mean=0.55,
        sessions_per_week=4,
    ),
    PilotProfile(
        username="pilot_average",
        full_label="Average mixed learner",
        preferred_style="mixed",
        adherence_mean=0.75,
        adherence_jitter=0.10,
        focus_mean=0.70,
        completion_mean=0.72,
        sessions_per_week=4,
    ),
)

PILOT_PASSWORD = "Pilot12345!"  # documented in docs/pilot-demo-guide.md

COURSE_CATALOG: tuple[tuple[str, int, float], ...] = (
    # (name, difficulty 1-5, weekly_target_hours)
    ("CSC 401 Algorithms", 4, 6.0),
    ("MTH 401 Numerical Methods", 5, 5.0),
    ("STA 401 Probability Models", 3, 4.0),
    ("PHY 301 Modern Physics", 3, 3.0),
    ("ENG 401 Software Engineering", 4, 5.0),
)

# Each pilot picks three courses by index (deterministic per pilot)
PILOT_COURSE_INDICES = {
    "pilot_consistent": (0, 1, 4),
    "pilot_struggling": (0, 2, 3),
    "pilot_improving": (1, 2, 4),
    "pilot_declining": (0, 3, 4),
    "pilot_average": (0, 1, 2),
}

SEED_DAYS_WINDOW = 28


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _bounded_normal(rng: random.Random, mean: float, jitter: float) -> float:
    return _clamp(rng.gauss(mean, jitter))


class Command(BaseCommand):
    help = "Seed deterministic pilot demo data for Chapter 4 screenshots and end-to-end demos."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete prior pilot users entirely before reseeding (default keeps users, clears their data).",
        )

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        reset = bool(options.get("reset"))
        rng = random.Random(20260529)

        now = timezone.now()
        seed_start = now - timedelta(days=SEED_DAYS_WINDOW)

        if reset:
            deleted, _ = User.objects.filter(username__in=[p.username for p in PILOTS]).delete()
            self.stdout.write(self.style.WARNING(f"Reset: deleted {deleted} pilot user records and cascaded data."))

        for profile in PILOTS:
            user = self._upsert_user(profile)
            self._clear_existing_data(user)
            courses = self._upsert_courses(user, profile)
            plan = self._seed_plan(user, courses, now)
            self._seed_recommendations(user, profile, plan, seed_start, now)
            self._seed_sessions(user, profile, courses, seed_start, now, rng)
            self.stdout.write(self.style.SUCCESS(f"Seeded pilot: {user.username} ({profile.full_label})"))

        self.stdout.write(self.style.SUCCESS(""))
        self.stdout.write(self.style.SUCCESS(f"Done. {len(PILOTS)} pilot users seeded. Password for all: {PILOT_PASSWORD}"))
        self.stdout.write(self.style.SUCCESS("See docs/pilot-demo-guide.md for the screenshot checklist."))

    # -- helpers ----------------------------------------------------------------

    def _upsert_user(self, profile: PilotProfile) -> User:
        user, created = User.objects.get_or_create(
            username=profile.username,
            defaults={"email": f"{profile.username}@studyplanner.local"},
        )
        user.set_password(PILOT_PASSWORD)
        user.email = f"{profile.username}@studyplanner.local"
        user.save()
        if created:
            self.stdout.write(f"  + created user {profile.username}")
        return user

    def _clear_existing_data(self, user: User) -> None:
        StudySessionLog.objects.filter(user=user).delete()
        RecommendationLog.objects.filter(user=user).delete()
        StudyPlan.objects.filter(user=user).delete()
        # Courses are kept (re-upserted) to preserve external referential pointers

    def _upsert_courses(self, user: User, profile: PilotProfile) -> list[Course]:
        indices = PILOT_COURSE_INDICES[profile.username]
        result: list[Course] = []
        for idx in indices:
            name, difficulty, weekly = COURSE_CATALOG[idx]
            course, _ = Course.objects.update_or_create(
                user=user,
                name=name,
                defaults={"difficulty": difficulty, "weekly_target_hours": weekly},
            )
            result.append(course)
        return result

    def _seed_plan(self, user: User, courses: list[Course], now) -> StudyPlan:
        course_payload = [{"name": c.name, "difficulty": c.difficulty} for c in courses]
        total_hours = sum(c.weekly_target_hours for c in courses)
        allocations = generate_plan(total_hours, course_payload)
        week_start = (now - timedelta(days=now.weekday())).date()
        plan = StudyPlan.objects.create(
            user=user,
            week_start=week_start,
            plan_json={
                "total_available_hours": total_hours,
                "courses": course_payload,
                "allocations": allocations,
                "adherence_adjustments": {},
            },
        )
        # Backdate the plan to the start of the seed window so the planner history
        # shows it among older entries rather than always as "today".
        StudyPlan.objects.filter(pk=plan.pk).update(created_at=now - timedelta(days=SEED_DAYS_WINDOW // 2))
        return plan

    def _seed_recommendations(
        self,
        user: User,
        profile: PilotProfile,
        plan: StudyPlan,
        seed_start,
        now,
    ) -> None:
        # Three recommendation events: at start of window, midpoint, near present.
        markers = [seed_start, seed_start + timedelta(days=SEED_DAYS_WINDOW // 2), now - timedelta(days=1)]
        for marker in markers:
            strategies, confidence = get_recommendations(
                focus_score=profile.focus_mean,
                completion_rate=profile.completion_mean,
                preferred_style=profile.preferred_style,
            )
            log = RecommendationLog.objects.create(
                user=user,
                focus_score=profile.focus_mean,
                completion_rate=profile.completion_mean,
                preferred_style=profile.preferred_style,
                strategies_json=strategies,
                confidence=confidence,
            )
            RecommendationLog.objects.filter(pk=log.pk).update(created_at=marker)

    def _seed_sessions(
        self,
        user: User,
        profile: PilotProfile,
        courses: list[Course],
        seed_start,
        now,
        rng: random.Random,
    ) -> None:
        total_sessions = max(1, int(profile.sessions_per_week * SEED_DAYS_WINDOW / 7))
        session_gap_seconds = int((now - seed_start).total_seconds() / total_sessions)

        course_cycle: Iterable[Course] = _round_robin(courses)
        recent_dates: list = []  # rolling window for sessions_last_7_days
        for i, course in zip(range(total_sessions), course_cycle):
            planned_minutes = rng.choice([60, 75, 90, 105, 120])
            adherence_ratio = _bounded_normal(rng, profile.adherence_mean, profile.adherence_jitter)
            actual_minutes = max(0, int(round(planned_minutes * adherence_ratio)))
            adherence_score = round(min(1.0, actual_minutes / max(1, planned_minutes)), 2)
            focus_score = round(_bounded_normal(rng, profile.focus_mean, profile.adherence_jitter / 2), 2)
            completion_rate = round(_bounded_normal(rng, profile.completion_mean, profile.adherence_jitter / 2), 2)

            target_ts = seed_start + timedelta(seconds=session_gap_seconds * i)

            # Compute the same rolling feature inputs that SessionLogView would
            # compute at log-time, so predicted_adherence reflects the model on
            # realistic state rather than zeros.
            cutoff = target_ts - timedelta(days=7)
            recent_dates = [d for d in recent_dates if d >= cutoff]
            recent_dates.append(target_ts)
            sessions_last_7_days = len(recent_dates)
            created_at_offset_days = (target_ts - seed_start).days
            consistency_score = min(1.0, sessions_last_7_days / 7.0)

            feature_payload = build_feature_payload(
                planned_minutes=planned_minutes,
                completion_rate=completion_rate,
                sessions_last_7_days=sessions_last_7_days,
                focus_score=focus_score,
                consistency_score=consistency_score,
                created_at_offset_days=created_at_offset_days,
            )
            predicted_adherence, model_version = predict_adherence(feature_payload)

            log = StudySessionLog.objects.create(
                user=user,
                course_name=course.name,
                planned_minutes=planned_minutes,
                actual_minutes=actual_minutes,
                focus_score=focus_score,
                completion_rate=completion_rate,
                adherence_score=adherence_score,
                predicted_adherence=predicted_adherence,
                model_version=model_version,
            )
            StudySessionLog.objects.filter(pk=log.pk).update(created_at=target_ts)


def _round_robin(items: list):
    while True:
        for item in items:
            yield item
