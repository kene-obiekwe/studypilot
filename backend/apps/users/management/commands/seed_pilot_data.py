"""
Seed deterministic pilot demo data for Chapter 4 screenshots and end-to-end demos.

Creates five pilot users with distinct adherence/focus profiles, three courses each,
one study plan and roughly 18 session logs spread over the last 28 days. Timestamps are backdated so the planner's 30-day
adherence-factor lookup and the progress dashboard's history paging both show
meaningful content immediately.

Courses carry learning traits, with exam dates relative to the seed date. Some profiles also
have a session "shape" (an adherence trend, or long sessions that finish poorly) so the
course recommendation engine's patterns show up in the demo.

This is demo data for system validation, NOT real pilot user feedback. Real pilot
feedback is collected separately and remains future work.

Re-running the command is safe: it uses get_or_create for users and courses, and
clears prior plans, shown strategies and sessions for the pilot accounts before
re-seeding so the data stays deterministic across runs.

Passwords: the pilot accounts get the PILOT_PASSWORD environment variable, or, when it is
unset and DEBUG is True, the development default. With DEBUG off the command refuses to run
unless --allow-production is passed and PILOT_PASSWORD passes Django's password validators.

Usage (from backend/):

    python manage.py seed_pilot_data
    python manage.py seed_pilot_data --reset
    PILOT_PASSWORD=... python manage.py seed_pilot_data --allow-production
"""

from __future__ import annotations

import os
import random
from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.planner.models import Course, StudyPlan
from apps.planner.services import ADJUSTMENT_SOURCE_NONE, catch_up_split
from apps.planner.weekly import BREAK_MINUTES, FOCUS_BLOCK_MINUTES, MODE_FIRST, compose_plan_json
from apps.recommendations.models import ShownStrategy
from apps.tracking.inference import STATUS_OK, forecast_course
from apps.tracking.models import StudySessionLog
from apps.users.verification import mark_verified


@dataclass(frozen=True)
class PilotProfile:
    username: str
    full_label: str
    adherence_mean: float       # baseline ratio of actual / planned minutes
    adherence_jitter: float     # +- noise applied per session
    focus_mean: float
    completion_mean: float
    sessions_per_week: int      # roughly how many sessions to seed per 7-day window
    # Session "shapes" so the recommendation engine's patterns show up in the demo:
    adherence_trend: float = 0.0               # change in mean adherence from first to last session
    alternate_session_lengths: bool = False    # alternate short (45-60) and long (90-120) plans
    long_session_completion_drop: float = 0.0  # completion lost on 90+ minute sessions


PILOTS: tuple[PilotProfile, ...] = (
    PilotProfile(
        username="pilot_consistent",
        full_label="Consistent high adherer",
        adherence_mean=0.92,
        adherence_jitter=0.08,
        focus_mean=0.82,
        completion_mean=0.84,
        sessions_per_week=5,
    ),
    PilotProfile(
        username="pilot_struggling",
        full_label="Struggling learner",
        adherence_mean=0.45,
        adherence_jitter=0.15,
        focus_mean=0.40,
        completion_mean=0.42,
        sessions_per_week=3,
    ),
    PilotProfile(
        username="pilot_improving",
        full_label="Improving learner",
        adherence_mean=0.70,
        adherence_jitter=0.12,
        focus_mean=0.65,
        completion_mean=0.68,
        sessions_per_week=4,
        adherence_trend=0.30,
    ),
    PilotProfile(
        username="pilot_declining",
        full_label="Declining learner",
        adherence_mean=0.60,
        adherence_jitter=0.18,
        focus_mean=0.55,
        completion_mean=0.55,
        sessions_per_week=4,
        adherence_trend=-0.40,
    ),
    PilotProfile(
        username="pilot_average",
        full_label="Average mixed learner whose long sessions fade",
        adherence_mean=0.75,
        adherence_jitter=0.10,
        focus_mean=0.70,
        completion_mean=0.72,
        sessions_per_week=5,
        alternate_session_lengths=True,
        long_session_completion_drop=0.35,
    ),
)

DEV_DEFAULT_PASSWORD = "Pilot12345!"
PASSWORD_ENV_VAR = "PILOT_PASSWORD"

COURSE_CATALOG: tuple[tuple[str, int, float], ...] = (
    # (name, difficulty 1-5, weekly_target_hours)
    ("CSC 401 Algorithms", 4, 6.0),
    ("MTH 401 Numerical Methods", 5, 5.0),
    ("STA 401 Probability Models", 3, 4.0),
    ("PHY 301 Modern Physics", 3, 3.0),
    ("ENG 401 Software Engineering", 4, 5.0),
)

# Learning traits per course: (learning_demands, builds_on_earlier, assessment_format,
# exam in N days from the seed date or None). Relative dates keep the demo current.
COURSE_TRAITS: dict[str, tuple[list[str], bool, str, int | None]] = {
    "CSC 401 Algorithms": (["problem_solving", "conceptual"], True, "timed_problem_exam", 18),
    "MTH 401 Numerical Methods": (["problem_solving"], True, "timed_problem_exam", 6),
    "STA 401 Probability Models": (["problem_solving", "memorisation"], True, "continuous_quizzes", None),
    "PHY 301 Modern Physics": (["conceptual", "problem_solving"], False, "multiple_choice", 35),
    "ENG 401 Software Engineering": (["writing", "practical"], False, "coursework", None),
}

# Each pilot picks three courses by index (deterministic per pilot)
PILOT_COURSE_INDICES = {
    "pilot_consistent": (0, 1, 4),
    "pilot_struggling": (0, 2, 3),
    "pilot_improving": (1, 2, 4),
    "pilot_declining": (0, 3, 4),
    "pilot_average": (0, 1, 2),
}

SEED_DAYS_WINDOW = 28
SEEDED_SESSION_HOURS = 1.5  # mean planned session length (60-120 minutes)


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
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help=f"Allow seeding when DEBUG is off. Requires a strong {PASSWORD_ENV_VAR}.",
        )

    def _resolve_password(self, allow_production: bool) -> tuple[str, str]:
        """Return (password, source). Raises CommandError before anything is written."""
        env_password = os.environ.get(PASSWORD_ENV_VAR, "")
        if settings.DEBUG:
            if env_password:
                return env_password, PASSWORD_ENV_VAR
            return DEV_DEFAULT_PASSWORD, "dev default"

        if not allow_production:
            raise CommandError(
                "Refusing to seed demo accounts while DEBUG is off. These are known demo users; "
                f"to seed anyway pass --allow-production and set {PASSWORD_ENV_VAR} to a strong password."
            )
        if not env_password:
            raise CommandError(
                f"--allow-production needs the {PASSWORD_ENV_VAR} environment variable set to a strong password."
            )
        problems: list[str] = []
        for profile in PILOTS:
            candidate = User(username=profile.username, email=f"{profile.username}@studyplanner.local")
            try:
                validate_password(env_password, user=candidate)
            except ValidationError as exc:
                problems.extend(message for message in exc.messages if message not in problems)
        if problems:
            raise CommandError(f"{PASSWORD_ENV_VAR} is too weak: " + " ".join(problems))
        return env_password, PASSWORD_ENV_VAR

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        reset = bool(options.get("reset"))
        password, password_source = self._resolve_password(bool(options.get("allow_production")))
        rng = random.Random(20260529)

        now = timezone.now()
        seed_start = now - timedelta(days=SEED_DAYS_WINDOW)

        if reset:
            deleted, _ = User.objects.filter(username__in=[p.username for p in PILOTS]).delete()
            self.stdout.write(self.style.WARNING(f"Reset: deleted {deleted} pilot user records and cascaded data."))

        for profile in PILOTS:
            user = self._upsert_user(profile, password)
            self._clear_existing_data(user)
            courses = self._upsert_courses(user, profile)
            plan = self._seed_plan(user, profile, courses, now)
            self._seed_sessions(user, profile, courses, seed_start, now, rng)
            self.stdout.write(self.style.SUCCESS(f"Seeded pilot: {user.username} ({profile.full_label})"))

        self.stdout.write(self.style.SUCCESS(""))
        self.stdout.write(
            self.style.SUCCESS(f"Done. {len(PILOTS)} pilot users seeded. Password for all: from {password_source}.")
        )

    # -- helpers ----------------------------------------------------------------

    def _upsert_user(self, profile: PilotProfile, password: str) -> User:
        user, created = User.objects.get_or_create(
            username=profile.username,
            defaults={"email": f"{profile.username}@studyplanner.local"},
        )
        user.set_password(password)
        user.email = f"{profile.username}@studyplanner.local"
        user.save()
        mark_verified(user)  # demo accounts have no inbox to verify from
        if created:
            self.stdout.write(f"  + created user {profile.username}")
        return user

    def _clear_existing_data(self, user: User) -> None:
        StudySessionLog.objects.filter(user=user).delete()
        ShownStrategy.objects.filter(user=user).delete()
        StudyPlan.objects.filter(user=user).delete()
        # Courses are kept (re-upserted) to preserve external referential pointers

    def _upsert_courses(self, user: User, profile: PilotProfile) -> list[Course]:
        indices = PILOT_COURSE_INDICES[profile.username]
        today = timezone.localdate()
        result: list[Course] = []
        for idx in indices:
            name, difficulty, weekly = COURSE_CATALOG[idx]
            demands, builds_on_earlier, assessment_format, exam_in_days = COURSE_TRAITS[name]
            course, _ = Course.objects.update_or_create(
                user=user,
                name=name,
                defaults={
                    "difficulty": difficulty,
                    "weekly_target_hours": weekly,
                    "learning_demands": demands,
                    "builds_on_earlier": builds_on_earlier,
                    "assessment_format": assessment_format,
                    "exam_date": today + timedelta(days=exam_in_days) if exam_in_days is not None else None,
                },
            )
            result.append(course)
        return result

    def _seed_plan(self, user: User, profile: PilotProfile, courses: list[Course], now) -> StudyPlan:
        # Sized to the hours the profile actually plans, so "under-studied vs this week's plan"
        # reflects the profile (low adherers fall behind) rather than an oversized plan.
        total_hours = profile.sessions_per_week * SEEDED_SESSION_HOURS
        week_start = (now - timedelta(days=now.weekday())).date()
        # The plan a pilot made on Monday, before logging anything: one current revision.
        split = catch_up_split(
            total_hours, [{"name": c.name, "difficulty": c.difficulty, "factor": 1.0, "logged": 0.0} for c in courses]
        )
        entries = [
            {
                "course_id": course.id,
                "name": course.name,
                "difficulty": course.difficulty,
                "factor": 1.0,
                "adjustment_source": ADJUSTMENT_SOURCE_NONE,
                "adherence_estimate": None,
                "entered_on": week_start.isoformat(),
                "logged_at_revision": 0.0,
                "remaining_at_revision": share["remaining_hours"],
                "planned_hours": share["planned_hours"],
                "focus_block_minutes": FOCUS_BLOCK_MINUTES,
                "break_minutes": BREAK_MINUTES,
            }
            for course, share in zip(courses, split)
        ]
        plan = StudyPlan.objects.create(
            user=user,
            week_start=week_start,
            revision=1,
            is_current=True,
            plan_json=compose_plan_json(
                mode=MODE_FIRST, made_on=week_start, entries=entries, removed=[], more_hours=total_hours, clamped=False
            ),
        )
        # Backdate the plan to the start of the seed window so the planner history
        # shows it among older entries rather than always as "today".
        StudyPlan.objects.filter(pk=plan.pk).update(created_at=now - timedelta(days=SEED_DAYS_WINDOW // 2))
        return plan


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
        for i, course in zip(range(total_sessions), course_cycle):
            if profile.alternate_session_lengths:
                # With three courses in rotation, each course also alternates short and long.
                planned_minutes = rng.choice([45, 60] if i % 2 == 0 else [90, 120])
            else:
                planned_minutes = rng.choice([60, 75, 90, 105, 120])
            progress = i / max(1, total_sessions - 1)
            adherence_mean = profile.adherence_mean + profile.adherence_trend * (progress - 0.5)
            adherence_ratio = _bounded_normal(rng, adherence_mean, profile.adherence_jitter)
            actual_minutes = max(0, int(round(planned_minutes * adherence_ratio)))
            adherence_score = round(min(1.0, actual_minutes / max(1, planned_minutes)), 2)
            focus_score = round(_bounded_normal(rng, profile.focus_mean, profile.adherence_jitter / 2), 2)
            completion_mean = profile.completion_mean
            if planned_minutes >= 90:
                completion_mean -= profile.long_session_completion_drop
            completion_rate = round(_bounded_normal(rng, completion_mean, profile.adherence_jitter / 2), 2)

            # Half a gap in from the window start, so every session is inside the last 28 days.
            target_ts = seed_start + timedelta(seconds=session_gap_seconds * i + session_gap_seconds // 2)

            # Same forecast SessionLogView stores at log time: this course's
            # current week, from the complete weeks already seeded before it.
            forecast = forecast_course(user, course.name, now=target_ts)
            if forecast.status == STATUS_OK:
                predicted_adherence, model_version = forecast.predicted_adherence, forecast.model_version
            else:
                predicted_adherence, model_version = None, forecast.status

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
