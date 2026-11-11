from datetime import date, datetime, timezone, timedelta
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

    assert current_period_start(after_utc_midnight_on_saturday, "week") == date(2026, 10, 31)


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

def test_twelve_recent_periods_include_current_for_all_cadences():
    last_period_starts = _function("last_period_starts")
    now = datetime(2026, 11, 10, 18, 30, tzinfo=timezone.utc)
    expected = {
        "hour": [
            f"2026-11-10T{hour:02d}:00:00-06:00" for hour in range(1, 13)
        ],
        "day": [
            (date(2026, 10, 30) + timedelta(days=offset)).isoformat()
            for offset in range(12)
        ],
        "week": [
            (date(2026, 8, 22) + timedelta(days=7 * offset)).isoformat()
            for offset in range(12)
        ],
        "month": [
            f"{year:04d}-{month:02d}-01"
            for year, month in [(2025, 12)] + [(2026, month) for month in range(1, 12)]
        ],
        "year": [date(2015 + offset, 1, 1).isoformat() for offset in range(12)],
    }

    for cadence, expected_starts in expected.items():
        assert [item.isoformat() for item in last_period_starts(now, cadence, count=12)] == expected_starts


def test_hour_ranges_include_23_or_25_periods_across_dst():
    intersecting_period_starts = _function("intersecting_period_starts")

    spring = intersecting_period_starts(date(2026, 3, 8), date(2026, 3, 8), "hour")
    fall = intersecting_period_starts(date(2026, 11, 1), date(2026, 11, 1), "hour")

    assert len(spring) == 23
    assert [item.isoformat() for item in fall].count("2026-11-01T01:00:00-05:00") == 1
    assert [item.isoformat() for item in fall].count("2026-11-01T01:00:00-06:00") == 1
    assert len(fall) == 25

def test_month_and_year_ranges_include_each_intersecting_calendar_period():
    intersecting_period_starts = _function("intersecting_period_starts")

    assert intersecting_period_starts(date(2026, 10, 31), date(2026, 11, 1), "month") == [
        date(2026, 10, 1),
        date(2026, 11, 1),
    ]
    assert intersecting_period_starts(date(2025, 12, 31), date(2026, 1, 1), "year") == [
        date(2025, 1, 1),
        date(2026, 1, 1),
    ]
