"""Date-range energy reports: generator, solar, consumption.

Aggregates saved energy_samples (power snapshots) and generator_runs into
totals for a selected period. The generator report integrates over run
windows so the split reflects only what the genset fed; solar and
consumption integrate over the whole range.
"""
from datetime import datetime, timedelta, timezone
from statistics import median

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from auth import require_user
from database import EnergySample, GeneratorRun, SessionLocal

router = APIRouter(prefix="/api/reports", dependencies=[Depends(require_user)])

KINDS = ("generator", "solar", "consumption")
MAX_RANGE_DAYS = 366
SAMPLE_CAP = 50000
RUN_LIST_CAP = 200

# Operator-measured fuel for the three latest distinct, completed runs on
# 2026-09-23/24. Keep this calibration fixed when new runs arrive; fuel use is
# estimated from metered output, not measured by the GX.
FUEL_CALIBRATION_LITERS = 11.0
FUEL_CALIBRATION_RUNS = (
    ("2026-09-23T19:21:46.213284+00:00", 9.4564),
    ("2026-09-24T08:21:59.503356+00:00", 1.6158),
    ("2026-09-24T08:54:10.996130+00:00", 6.0334),
)
FUEL_CALIBRATION_KWH = sum(energy for _, energy in FUEL_CALIBRATION_RUNS)
FUEL_LITERS_PER_KWH = FUEL_CALIBRATION_LITERS / FUEL_CALIBRATION_KWH


def _row_value(row, key):
    return key(row) if callable(key) else getattr(row, key)


def _accepted_segments(rows, value_of, windows=None):
    """Yield (midpoint_ts, kwh, (i, i+1)) for consecutive-sample segments.

    Trapezoid integration, skipping pairs where either side is None for this
    series — pre-migration rows simply don't contribute.

    The gap guard adapts to the recording interval instead of reusing the
    collector's fixed 180 s rule: the collector sees telemetry every 10 s,
    but summaries are written every 5-60 minutes, so a fixed guard would
    discard every segment here. Accept up to 2.5x the median spacing: one
    missed write survives, two in a row do not.
    """
    if len(rows) < 2:
        return
    times = [row.recorded_at.timestamp() for row in rows]
    spacings = [b - a for a, b in zip(times, times[1:]) if b > a]
    if not spacings:
        return
    limit = max(median(spacings) * 2.5, 120.0)
    for i in range(len(rows) - 1):
        elapsed = times[i + 1] - times[i]
        if not 0 < elapsed <= limit:
            continue
        v0 = _row_value(rows[i], value_of)
        v1 = _row_value(rows[i + 1], value_of)
        if v0 is None or v1 is None:
            continue
        midpoint = times[i] + elapsed / 2
        if windows is not None and not any(start <= midpoint <= end for start, end in windows):
            continue
        yield midpoint, (v0 + v1) / 2 * elapsed / 3_600_000.0, (i, i + 1)


def integrate_series(rows, key, windows=None):
    """kWh integral of one series over rows sorted by recorded_at ascending.

    Returns (kwh, samples_used) — (None, 0) when no pair of usable samples
    forms an accepted segment.
    """
    total = 0.0
    used = set()
    for _midpoint, kwh, pair in _accepted_segments(rows, key, windows):
        total += kwh
        used.update(pair)
    return (round(total, 4) if used else None), len(used)


def integrate_daily(rows, key, tz_offset_minutes):
    """kWh per local day, bucketed on each segment midpoint."""
    offset = timedelta(minutes=tz_offset_minutes)
    buckets = {}
    for midpoint, kwh, _ in _accepted_segments(rows, key):
        day = (datetime.fromtimestamp(midpoint, timezone.utc) + offset).date().isoformat()
        buckets[day] = buckets.get(day, 0.0) + kwh
    return {day: round(kwh, 4) for day, kwh in buckets.items()}


def _battery_value(sign):
    def value(row):
        if row.battery_power is None:
            return None
        return max(sign * row.battery_power, 0.0)
    return value


def _genset_total(row):
    # ac_in_power only lands in summaries from 2026-09-22; generator_power
    # covers run windows before that.
    return row.ac_in_power if row.ac_in_power is not None else row.generator_power


def run_windows(runs, range_start_ts, range_end_ts):
    windows = []
    for run in runs:
        start = max(run.started_at.timestamp(), range_start_ts)
        end = min((run.ended_at or run.updated_at or run.started_at).timestamp(), range_end_ts)
        if end > start:
            windows.append((start, end))
    return windows


def run_payload(row):
    """Same shape as main.run_payload (kept local to avoid a circular import)."""
    return {
        "started_at": row.started_at.isoformat(),
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "duration_seconds": row.duration_seconds,
        "energy_kwh": row.energy_kwh,
        "peak_power_w": row.peak_power_w,
    }


def unique_runs(runs):
    """Collapse old duplicate rows from runs saved once active and once finished."""
    by_start = {}
    for run in runs:
        previous = by_start.get(run.started_at)
        if previous is None or (
            run.duration_seconds if run.duration_seconds is not None else -1,
            run.energy_kwh is not None,
        ) > (
            previous.duration_seconds if previous.duration_seconds is not None else -1,
            previous.energy_kwh is not None,
        ):
            by_start[run.started_at] = run
    return sorted(by_start.values(), key=lambda run: run.started_at, reverse=True)


def run_stats(runs):
    durations = [run.duration_seconds or 0.0 for run in runs]
    known = [run.energy_kwh for run in runs if run.energy_kwh is not None]
    peaks = [run.peak_power_w for run in runs if run.peak_power_w is not None]
    return {
        "count": len(runs),
        "total_duration_seconds": round(sum(durations), 1),
        "avg_duration_seconds": round(sum(durations) / len(durations), 1) if durations else None,
        "max_duration_seconds": round(max(durations), 1) if durations else None,
        "peak_power_w": max(peaks) if peaks else None,
        # Runs without power telemetry keep energy_kwh NULL: counted above,
        # excluded from the kWh sums.
        "energy_kwh": round(sum(known), 3) if known else None,
        "energy_known_runs": len(known),
    }


def runs_daily(runs, tz_offset_minutes, range_start, range_end):
    """One bucket per local start day. A run straddling midnight counts
    entirely on its start day."""
    offset = timedelta(minutes=tz_offset_minutes)
    buckets = {}
    for run in runs:
        if not range_start <= run.started_at <= range_end:
            continue
        day = (run.started_at + offset).date().isoformat()
        bucket = buckets.setdefault(day, {"runs": 0, "duration": 0.0, "kwh": None})
        bucket["runs"] += 1
        bucket["duration"] += run.duration_seconds or 0.0
        if run.energy_kwh is not None:
            bucket["kwh"] = (bucket["kwh"] or 0.0) + run.energy_kwh
    return [{"date": day,
             "energy_kwh": round(bucket["kwh"], 3) if bucket["kwh"] is not None else None,
             "duration_seconds": round(bucket["duration"], 1),
             "runs": bucket["runs"]}
            for day, bucket in sorted(buckets.items())]


def runs_monthly(runs, tz_offset_minutes, range_start, range_end):
    """Bucket complete run energy by local start month, without duplicating runs.

    Runs outside the requested start-date range are excluded. Unmetered runs
    still count, but never acquire invented fuel or cost estimates.
    """
    offset = timedelta(minutes=tz_offset_minutes)
    buckets = {}
    for run in runs:
        if not range_start <= run.started_at <= range_end:
            continue
        month = (run.started_at + offset).strftime("%Y-%m")
        bucket = buckets.setdefault(month, {"runs": 0, "metered_runs": 0,
                                            "duration_seconds": 0.0, "energy_kwh": 0.0})
        bucket["runs"] += 1
        bucket["duration_seconds"] += run.duration_seconds or 0.0
        if run.energy_kwh is not None:
            bucket["metered_runs"] += 1
            bucket["energy_kwh"] += run.energy_kwh
    return [{"month": month, "runs": bucket["runs"],
             "metered_runs": bucket["metered_runs"],
             "duration_seconds": round(bucket["duration_seconds"], 1),
             "energy_kwh": round(bucket["energy_kwh"], 4) if bucket["metered_runs"] else None}
            for month, bucket in sorted(buckets.items())]


@router.get("/{kind}")
async def report(kind: str,
                 from_time: datetime | None = Query(None, alias="from"),
                 to_time: datetime | None = Query(None, alias="to"),
                 tz_offset_minutes: int = Query(0, ge=-720, le=840)):
    if kind not in KINDS:
        raise HTTPException(404, "Unknown report kind")
    to_time = to_time or datetime.now(timezone.utc)
    from_time = from_time or to_time - timedelta(days=30)
    if from_time.tzinfo is None or to_time.tzinfo is None:
        raise HTTPException(422, "Timestamps must include a timezone offset")
    if from_time > to_time:
        raise HTTPException(422, "Start time must precede end time")
    if to_time - from_time > timedelta(days=MAX_RANGE_DAYS):
        raise HTTPException(422, "Range is limited to 366 days")

    async with SessionLocal() as session:
        samples = (await session.execute(
            select(EnergySample)
            .where(EnergySample.recorded_at >= from_time,
                   EnergySample.recorded_at <= to_time)
            .order_by(EnergySample.recorded_at.asc())
            .limit(SAMPLE_CAP + 1)
        )).scalars().all()
        runs = (await session.execute(
            select(GeneratorRun)
            .where(GeneratorRun.started_at <= to_time,
                   func.coalesce(GeneratorRun.ended_at, GeneratorRun.updated_at) >= from_time)
            .order_by(GeneratorRun.started_at.desc())
        )).scalars().all()

    runs = unique_runs(runs)
    complete = len(samples) > SAMPLE_CAP
    samples = samples[:SAMPLE_CAP]
    times = [row.recorded_at.timestamp() for row in samples]
    spacings = [b - a for a, b in zip(times, times[1:]) if b > a]

    head = {
        "kind": kind,
        "from": from_time.isoformat(),
        "to": to_time.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "samples": {"used": len(samples), "complete": complete,
                    "median_interval_seconds": round(median(spacings), 1) if spacings else None},
    }

    if kind == "generator":
        windows = run_windows(runs, from_time.timestamp(), to_time.timestamp())
        genset_kwh, total_used = integrate_series(samples, _genset_total, windows)
        ac_kwh, ac_used = integrate_series(samples, "load_power", windows)
        dc_kwh, dc_used = integrate_series(samples, "dc_load_power", windows)
        charged_kwh, _charged_used = integrate_series(samples, _battery_value(-1), windows)
        energy = None
        if total_used:
            energy = {
                "window": "runs",
                "genset_kwh": genset_kwh,
                "ac_loads_kwh": ac_kwh,
                "dc_loads_kwh": dc_kwh,
                # Remainder keeps the identity exact, mirroring the live
                # generator panel: total in = AC loads + DC loads + charging.
                "charging_kwh": round(max((genset_kwh or 0.0) - (ac_kwh or 0.0)
                                          - (dc_kwh or 0.0), 0.0), 4),
                "battery_charged_kwh": charged_kwh,
                "total_in_samples": total_used,
                "ac_loads_samples": ac_used,
                "dc_loads_samples": dc_used,
            }
        return {**head,
                "runs": run_stats(runs),
                "run_list": [run_payload(row) for row in runs[:RUN_LIST_CAP]],
                "energy": energy,
                "daily": runs_daily(runs, tz_offset_minutes, from_time, to_time),
                "monthly": runs_monthly(runs, tz_offset_minutes, from_time, to_time),
                "fuel_calibration": {
                    "measured_liters": FUEL_CALIBRATION_LITERS,
                    "metered_kwh": FUEL_CALIBRATION_KWH,
                    "liters_per_kwh": round(FUEL_LITERS_PER_KWH, 6),
                    "run_starts": [start for start, _ in FUEL_CALIBRATION_RUNS],
                }}

    if kind == "solar":
        generated_kwh, gen_used = integrate_series(samples, "solar_power")
        ac_kwh, ac_used = integrate_series(samples, "load_power")
        dc_kwh, dc_used = integrate_series(samples, "dc_load_power")
        charged_kwh, _charged_used = integrate_series(samples, _battery_value(-1), windows=None)
        energy = None
        if gen_used or ac_used or dc_used:
            energy = {
                "window": "range",
                "generated_kwh": generated_kwh,
                "ac_loads_kwh": ac_kwh,
                "dc_loads_kwh": dc_kwh,
                "charging_kwh": round(max((generated_kwh or 0.0) - (ac_kwh or 0.0)
                                          - (dc_kwh or 0.0), 0.0), 4),
                "battery_charged_kwh": charged_kwh,
                "generated_samples": gen_used,
                "ac_loads_samples": ac_used,
                "dc_loads_samples": dc_used,
            }
        return {**head,
                "energy": energy,
                "daily": [{"date": day, "energy_kwh": kwh}
                          for day, kwh in sorted(integrate_daily(
                              samples, "solar_power", tz_offset_minutes).items())]}

    # Consumption
    ac_kwh, ac_used = integrate_series(samples, "load_power")
    dc_kwh, dc_used = integrate_series(samples, "dc_load_power")
    discharged_kwh, discharged_used = integrate_series(samples, _battery_value(1))
    grid_kwh, grid_used = integrate_series(samples, "grid_power")
    energy = None
    if ac_used or dc_used or discharged_used or grid_used:
        energy = {
            "window": "range",
            "ac_loads_kwh": ac_kwh,
            "dc_loads_kwh": dc_kwh,
            "battery_discharged_kwh": discharged_kwh,
            "grid_import_kwh": grid_kwh,
            "ac_loads_samples": ac_used,
            "dc_loads_samples": dc_used,
            "battery_discharged_samples": discharged_used,
            "grid_import_samples": grid_used,
        }
    return {**head,
            "energy": energy,
            "daily": [{"date": day, "energy_kwh": kwh}
                      for day, kwh in sorted(integrate_daily(
                          samples, "load_power", tz_offset_minutes).items())]}
