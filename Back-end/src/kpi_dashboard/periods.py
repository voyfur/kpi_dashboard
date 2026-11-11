"""Calendar period rules for KPI dashboard values."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo


Cadence = Literal["hour", "day", "week", "month", "year"]
PROJECT_TIMEZONE = "America/Chicago"


PeriodStart = date | datetime


def period_start_for(day: PeriodStart, cadence: Cadence) -> PeriodStart:
    if cadence == "hour":
        if isinstance(day, datetime):
            if day.utcoffset() is None:
                raise ValueError("hour periods require timezone-aware timestamps")
            return day.astimezone(ZoneInfo(PROJECT_TIMEZONE)).replace(minute=0, second=0, microsecond=0)
        return datetime.combine(day, time.min, ZoneInfo(PROJECT_TIMEZONE))
    if isinstance(day, datetime):
        day = day.astimezone(ZoneInfo(PROJECT_TIMEZONE)).date()
    if cadence == "day":
        return day
    if cadence == "week":
        return day - timedelta(days=(day.weekday() - 5) % 7)
    if cadence == "month":
        return date(day.year, day.month, 1)
    if cadence == "year":
        return date(day.year, 1, 1)
    raise ValueError("unsupported KPI cadence")


def next_period_start(start: PeriodStart, cadence: Cadence) -> PeriodStart:
    current = period_start_for(start, cadence)
    if cadence == "hour":
        assert isinstance(current, datetime)
        return (current.astimezone(timezone.utc) + timedelta(hours=1)).astimezone(ZoneInfo(PROJECT_TIMEZONE))
    assert isinstance(current, date) and not isinstance(current, datetime)
    if cadence == "day":
        return current + timedelta(days=1)
    if cadence == "week":
        return current + timedelta(days=7)
    if cadence == "month":
        return date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    if cadence == "year":
        return date(current.year + 1, 1, 1)
    raise ValueError("unsupported KPI cadence")


def current_period_start(
    now: datetime,
    cadence: Cadence,
    *,
    timezone_name: str = PROJECT_TIMEZONE,
) -> PeriodStart:
    if now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    local_now = now.astimezone(ZoneInfo(timezone_name))
    if cadence == "hour":
        return local_now.replace(minute=0, second=0, microsecond=0)
    local_day = local_now.date()
    return period_start_for(local_day, cadence)


def storage_period_start(
    period: PeriodStart,
    *,
    timezone_name: str = PROJECT_TIMEZONE,
) -> datetime:
    zone = ZoneInfo(timezone_name)
    if isinstance(period, datetime):
        if period.utcoffset() is None:
            raise ValueError("period timestamps must be timezone-aware")
        local_period = period.astimezone(zone)
    else:
        local_period = datetime.combine(period, time.min, zone)
    return local_period.astimezone(timezone.utc)


def last_period_starts(
    now: datetime,
    cadence: Cadence,
    *,
    count: int = 8,
    timezone_name: str = PROJECT_TIMEZONE,
) -> list[PeriodStart]:
    if count < 1:
        raise ValueError("count must be positive")
    starts = [current_period_start(now, cadence, timezone_name=timezone_name)]
    while len(starts) < count:
        latest = starts[-1]
        if cadence == "hour":
            assert isinstance(latest, datetime)
            previous = latest.astimezone(timezone.utc) - timedelta(hours=1)
            starts.append(previous.astimezone(ZoneInfo(timezone_name)))
        elif cadence == "day":
            assert isinstance(latest, date) and not isinstance(latest, datetime)
            starts.append(latest - timedelta(days=1))
        else:
            assert isinstance(latest, date) and not isinstance(latest, datetime)
            starts.append(period_start_for(latest - timedelta(days=1), cadence))
    return list(reversed(starts))


def intersecting_period_starts(
    start: date,
    end: date,
    cadence: Cadence,
) -> list[PeriodStart]:
    if start > end:
        raise ValueError("start must not be after end")
    starts: list[PeriodStart] = []
    if cadence == "hour":
        zone = ZoneInfo(PROJECT_TIMEZONE)
        period = datetime.combine(start, time.min, zone)
        end_exclusive = datetime.combine(end + timedelta(days=1), time.min, zone)
        while period < end_exclusive:
            starts.append(period)
            period = (period.astimezone(timezone.utc) + timedelta(hours=1)).astimezone(zone)
        return starts
    period = period_start_for(start, cadence)
    assert isinstance(period, date) and not isinstance(period, datetime)
    while period <= end:
        starts.append(period)
        next_period = next_period_start(period, cadence)
        assert isinstance(next_period, date) and not isinstance(next_period, datetime)
        period = next_period
    return starts
