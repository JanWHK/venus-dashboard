"""Pure unit tests for the report integrator — no database needed."""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost:5432/x")

from reports import (  # noqa: E402
    integrate_daily,
    integrate_series,
    run_stats,
    run_windows,
    runs_daily,
)

START = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)


def make_rows(offsets_seconds, **series):
    rows = []
    for i, offset in enumerate(offsets_seconds):
        values = {key: values[i] for key, values in series.items()}
        rows.append(SimpleNamespace(recorded_at=START + timedelta(seconds=offset), **values))
    return rows


def test_trapezoid_totals():
    rows = make_rows([0, 900, 1800], load_power=[0, 1000, 2000])
    kwh, used = integrate_series(rows, "load_power")
    assert kwh == 0.5
    assert used == 3


def test_gap_guard_rejects_widened_spacing():
    # Median spacing 900 s -> limit 2250 s: the 10800 s hole splits the series.
    rows = make_rows([0, 900, 1800, 12600, 13500],
                     load_power=[1000, 1000, 1000, 1000, 1000])
    kwh, used = integrate_series(rows, "load_power")
    assert kwh == 0.75  # 3 accepted segments x 0.25, the hole contributes nothing
    assert used == 5  # rows 0-2 left of the hole, rows 3-4 right of it


def test_missing_values_break_segments():
    rows = make_rows([0, 900, 1800], load_power=[1000, None, 3000])
    assert integrate_series(rows, "load_power") == (None, 0)


def test_windows_filter_by_midpoint():
    rows = make_rows([0, 900, 1800, 2700], load_power=[1000, 1000, 1000, 1000])
    windows = [((START + timedelta(seconds=1350)).timestamp(),
                (START + timedelta(seconds=2700)).timestamp())]
    kwh, used = integrate_series(rows, "load_power", windows)
    assert kwh == 0.5  # segments 2 and 3 only
    assert used == 3


def test_daily_buckets_use_the_local_offset():
    rows = make_rows([0, 900, 10 * 3600, 10 * 3600 + 900],
                     load_power=[1000, 1000, 1000, 1000])
    buckets = integrate_daily(rows, "load_power", tz_offset_minutes=120)
    # First pair falls on the 20th (12:00 UTC + 2 h), second on the 21st (22:00 UTC + 2 h).
    assert buckets == {"2026-09-20": 0.25, "2026-09-21": 0.25}


def test_run_windows_clip_to_range_and_close_open_runs():
    runs = [
        SimpleNamespace(started_at=START - timedelta(hours=2), ended_at=START + timedelta(hours=1),
                        updated_at=START + timedelta(hours=1)),
        SimpleNamespace(started_at=START + timedelta(hours=2), ended_at=None,
                        updated_at=START + timedelta(hours=3)),
    ]
    start_ts = START.timestamp()
    end_ts = (START + timedelta(hours=2, minutes=30)).timestamp()
    windows = run_windows(runs, start_ts, end_ts)
    assert windows == [
        (start_ts, (START + timedelta(hours=1)).timestamp()),
        ((START + timedelta(hours=2)).timestamp(), end_ts),
    ]


def test_run_stats_exclude_null_energy_but_keep_counting_runs():
    runs = [
        SimpleNamespace(duration_seconds=1500.0, energy_kwh=1.3, peak_power_w=3100.0),
        SimpleNamespace(duration_seconds=600.0, energy_kwh=None, peak_power_w=None),
    ]
    stats = run_stats(runs)
    assert stats["count"] == 2
    assert stats["energy_kwh"] == 1.3
    assert stats["energy_known_runs"] == 1
    assert stats["total_duration_seconds"] == 2100.0
    assert stats["peak_power_w"] == 3100.0
    assert run_stats([]) == {"count": 0, "total_duration_seconds": 0.0,
                             "avg_duration_seconds": None, "max_duration_seconds": None,
                             "peak_power_w": None, "energy_kwh": None, "energy_known_runs": 0}


def test_runs_daily_bucket_on_local_start_day():
    runs = [
        SimpleNamespace(started_at=START, duration_seconds=1500.0, energy_kwh=1.3),
        SimpleNamespace(started_at=START + timedelta(seconds=600), duration_seconds=600.0,
                        energy_kwh=None),
        SimpleNamespace(started_at=START - timedelta(days=1), duration_seconds=100.0,
                        energy_kwh=0.2),
    ]
    daily = runs_daily(runs, tz_offset_minutes=0, range_start=START - timedelta(days=1),
                       range_end=START + timedelta(days=1))
    assert [row["date"] for row in daily] == ["2026-09-19", "2026-09-20"]
    assert daily[1]["runs"] == 2
    assert daily[1]["duration_seconds"] == 2100.0
    assert daily[1]["energy_kwh"] == 1.3  # the NULL-energy run adds nothing
