from datetime import date, datetime, timezone
import importlib

import pytest


periods = importlib.import_module("kpi_dashboard.periods")


def _function(name):
    result = getattr(periods, name, None)
    assert callable(result), f"period behavior {name} must be implemented"
    return result


def test_week_starts_on_saturday():
    period_start_for = _function("period_start_for")
    next_period_start = _function("next_period_start")

    assert period_start_for(date(2026, 11, 6), "week") == date(2026, 10, 31)
    assert period_start_for(date(2026, 11, 7), "week") == date(2026, 11, 7)
    assert next_period_start(date(2026, 10, 31), "week") == date(2026, 11, 7)


def test_month_and_year_use_calendar_boundaries():
    period_start_for = _function("period_start_for")
    next_period_start = _function("next_period_start")

    assert period_start_for(date(2026, 11, 6), "month") == date(2026, 11, 1)
    assert next_period_start(date(2026, 11, 1), "month") == date(2026, 12, 1)
    assert period_start_for(date(2026, 11, 6), "year") == date(2026, 1, 1)
    assert next_period_start(date(2026, 1, 1), "year") == date(2027, 1, 1)


def test_current_period_uses_project_timezone_not_utc_date():
    current_period_start = _function("current_period_start")
    after_utc_midnight_on_saturday = datetime(2026, 11, 7, 0, 30, tzinfo=timezone.utc)

    assert current_period_start(after_utc_midnight_on_saturday, "week") == date(2026, 11, 7)


def test_recent_periods_include_current_incomplete_period():
    last_period_starts = _function("last_period_starts")
    now = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)

    assert last_period_starts(now, "week", count=3) == [
        date(2026, 10, 17),
        date(2026, 10, 24),
        date(2026, 10, 31),
    ]


def test_date_range_returns_full_intersecting_periods_without_aggregation():
    intersecting_period_starts = _function("intersecting_period_starts")

    assert intersecting_period_starts(date(2026, 11, 5), date(2026, 11, 9), "week") == [
        date(2026, 10, 31),
        date(2026, 11, 7),
    ]


def test_period_requires_timezone_aware_current_time():
    current_period_start = _function("current_period_start")

    with pytest.raises(ValueError, match="timezone-aware"):
        current_period_start(datetime(2026, 11, 7), "week")
