"""Calendar period rules for KPI dashboard values."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo


Cadence = Literal["week", "month", "year"]
PROJECT_TIMEZONE = "Europe/Kyiv"


def period_start_for(day: date, cadence: Cadence) -> date:
    if cadence == "week":
        return day - timedelta(days=(day.weekday() - 5) % 7)
    if cadence == "month":
        return date(day.year, day.month, 1)
    if cadence == "year":
        return date(day.year, 1, 1)
    raise ValueError("unsupported KPI cadence")


def next_period_start(start: date, cadence: Cadence) -> date:
    current = period_start_for(start, cadence)
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
) -> date:
    if now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    local_day = now.astimezone(ZoneInfo(timezone_name)).date()
    return period_start_for(local_day, cadence)


def last_period_starts(
    now: datetime,
    cadence: Cadence,
    *,
    count: int = 8,
    timezone_name: str = PROJECT_TIMEZONE,
) -> list[date]:
    if count < 1:
        raise ValueError("count must be positive")
    starts = [current_period_start(now, cadence, timezone_name=timezone_name)]
    while len(starts) < count:
        starts.append(period_start_for(starts[-1] - timedelta(days=1), cadence))
    return list(reversed(starts))


def intersecting_period_starts(
    start: date,
    end: date,
    cadence: Cadence,
) -> list[date]:
    if start > end:
        raise ValueError("start must not be after end")
    period = period_start_for(start, cadence)
    starts = []
    while period <= end:
        starts.append(period)
        period = next_period_start(period, cadence)
    return starts
