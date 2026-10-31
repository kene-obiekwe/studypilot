"""Day and week maths in a time zone. Pure helpers; callers pass the zone.

Weeks run Monday 00:00 to the next Monday 00:00 in the zone, so across a DST change a week is
167, 168 or 169 hours long. Bounds come from local midnights, never from a UTC instant plus 168 h.
"""

from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

from django.conf import settings
from django.utils import timezone

MAX_ZONE_LENGTH = 64


@lru_cache(maxsize=1)
def _known_zones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_valid_zone(name) -> bool:
    """True for an IANA name the server's tz database knows (aliases such as Asia/Calcutta included)."""
    return isinstance(name, str) and len(name) <= MAX_ZONE_LENGTH and name in _known_zones()


def default_zone() -> ZoneInfo:
    return ZoneInfo(settings.TIME_ZONE)


def zone_for(user) -> ZoneInfo:
    """The user's stored zone, else settings.TIME_ZONE. An unknown stored name also gives the default.

    Cached on the user instance only, so a change applies from the next request.
    """
    cached = getattr(user, "_clock_zone", None)
    if cached is not None:
        return cached
    zone = default_zone()
    preferences = getattr(user, "preferences", None) if getattr(user, "pk", None) is not None else None
    name = preferences.time_zone if preferences is not None else ""
    if name and is_valid_zone(name):
        try:
            zone = ZoneInfo(name)
        except (ValueError, OSError):
            pass
    user._clock_zone = zone
    return zone


def local_date(instant: datetime, zone: ZoneInfo) -> date:
    return timezone.localtime(instant, zone).date()


def today(zone: ZoneInfo, now: datetime | None = None) -> date:
    return local_date(now if now is not None else timezone.now(), zone)


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def day_start(day: date, zone: ZoneInfo) -> datetime:
    """Midnight starting `day` in `zone`. In a DST gap or overlap at midnight, fold=0 gives the correct start.

    The result is round-tripped through UTC so a gap midnight reads as the first valid wall time (01:00
    on the day Santiago skips 00:00). A raw 00:00 in a gap never compares equal to another zone's datetime.
    """
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(dt_timezone.utc).astimezone(zone)


def week_bounds(week_start: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    return day_start(week_start, zone), day_start(week_start + timedelta(days=7), zone)
