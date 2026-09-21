import asyncio
import logging
import time
from collections import deque
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select, text

from auth import initialize_auth, require_admin, require_csrf_header, require_user, router as auth_router
from collector import collector
import alerts
from database import DashboardSetting, EnergySample, GeneratorRun, SessionLocal, engine, init_db

VALID_INTERVALS = [0, 300, 600, 900, 1800, 3600]
SUMMARY_FIELDS = ["solar_power", "grid_power", "load_power", "battery_power", "battery_soc", "generator_power"]
live_history = deque(maxlen=90)
recording_interval = 0


async def save_summary(snapshot):
    values = {key: snapshot["metrics"].get(key) for key in SUMMARY_FIELDS}
    if snapshot["status"] != "live" or not any(value is not None for value in values.values()):
        return False
    async with SessionLocal() as session:
        session.add(EnergySample(recorded_at=datetime.now(timezone.utc), **values))
        await session.commit()
    return True


def active_run_duration(active):
    """Exact seconds so far: Timers counter delta when available."""
    if active["duration_base"] is not None and collector.timers_prev is not None:
        return max(0.0, collector.timers_prev - active["duration_base"])
    return max(0.0, time.time() - active["started_at"])


def run_row_values(run, ended=False):
    duration = run.get("duration_seconds")
    if duration is None and not ended:
        duration = active_run_duration(run)
    return {
        "duration_seconds": duration,
        "energy_kwh": round(run["energy_wh"] / 1000, 4) if run["power_seen"] else None,
        "peak_power_w": run["peak_w"],
        "updated_at": datetime.now(timezone.utc),
    }


async def persist_generator_runs():
    async with SessionLocal() as session:
        for run in collector.drain_generator_runs():
            session.add(GeneratorRun(
                started_at=datetime.fromtimestamp(run["started_at"], timezone.utc),
                ended_at=datetime.fromtimestamp(run["ended_at"], timezone.utc),
                **run_row_values(run, ended=True),
            ))
        active = collector.generator_run
        row = (await session.execute(
            select(GeneratorRun).where(GeneratorRun.ended_at.is_(None))
        )).scalar_one_or_none()
        if active:
            values = run_row_values(active)
            values["started_at"] = datetime.fromtimestamp(active["started_at"], timezone.utc)
            if row is None:
                session.add(GeneratorRun(ended_at=None, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
        elif row is not None:
            row.ended_at = row.updated_at
        await session.commit()


async def run_telemetry():
    last_saved = time.monotonic()
    tick = 0
    while True:
        snapshot = collector.snapshot()
        point = {key: snapshot["metrics"].get(key) for key in SUMMARY_FIELDS}
        point["recorded_at"] = datetime.now(timezone.utc).isoformat()
        live_history.append(point)
        if tick % 3 == 0:
            collector.keepalive()
        tick += 1
        try:
            await alerts.evaluate(snapshot)
        except Exception:
            logging.getLogger("uvicorn.error").exception("Could not evaluate battery alerts")
        now = time.monotonic()
        if recording_interval and now - last_saved >= recording_interval:
            last_saved = now
            try:
                await save_summary(snapshot)
            except Exception:
                logging.getLogger("uvicorn.error").exception("Could not save energy summary")
        try:
            await persist_generator_runs()
        except Exception:
            logging.getLogger("uvicorn.error").exception("Could not save generator run")
        await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global recording_interval
    await init_db()
    await initialize_auth()
    # Runs left open by a previous process can no longer see their real end.
    # The duration column already holds the exact seconds; close the window.
    async with SessionLocal() as session:
        await session.execute(
            text("UPDATE generator_runs SET ended_at = updated_at WHERE ended_at IS NULL"))
        await session.commit()
    async with SessionLocal() as session:
        setting = await session.get(DashboardSetting, 1)
        recording_interval = setting.interval_seconds if setting else 900
    collector.start()
    alerts.candidates.clear()
    alerts.last_check = None
    task = asyncio.create_task(run_telemetry())
    notification_task = asyncio.create_task(alerts.delivery_loop())
    try:
        yield
    finally:
        task.cancel()
        notification_task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        with suppress(asyncio.CancelledError):
            await notification_task
        await asyncio.to_thread(collector.stop)
        await engine.dispose()


app = FastAPI(title="Helio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(auth_router)
app.include_router(alerts.router)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok"}


def run_payload(row):
    return {
        "started_at": row.started_at.isoformat(),
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "duration_seconds": row.duration_seconds,
        "energy_kwh": row.energy_kwh,
        "peak_power_w": row.peak_power_w,
    }


@app.get("/api/live", dependencies=[Depends(require_user)])
async def live():
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(GeneratorRun).order_by(GeneratorRun.started_at.desc()).limit(3)
        )).scalars().all()
    active = collector.generator_run
    active_run = None
    if active:
        active_run = {
            "started_at": datetime.fromtimestamp(active["started_at"], timezone.utc).isoformat(),
            **run_row_values(active),
        }
        active_run.pop("updated_at", None)
    return {**collector.snapshot(), "history": list(live_history), "recording_interval": recording_interval,
            "generator_runs": {"active_run": active_run,
                               "recent": [run_payload(row) for row in rows]}}


@app.get("/api/devices", dependencies=[Depends(require_user)])
async def devices():
    return collector.snapshot(include_devices=True)


class SettingsIn(BaseModel):
    interval_seconds: int


@app.get("/api/settings", dependencies=[Depends(require_user)])
async def settings():
    return {"interval_seconds": recording_interval, "host": collector.host,
            "portal_id": collector.portal, "transport": collector.transport, "port": collector.port}


@app.put("/api/settings", dependencies=[Depends(require_csrf_header)])
async def update_settings(body: SettingsIn, user=Depends(require_admin)):
    global recording_interval
    if body.interval_seconds not in VALID_INTERVALS:
        raise HTTPException(422, "Choose live only, 5, 10, 15, 30 minutes or 1 hour")
    async with SessionLocal() as session:
        setting = await session.get(DashboardSetting, 1)
        if setting:
            setting.interval_seconds = body.interval_seconds
        else:
            session.add(DashboardSetting(id=1, interval_seconds=body.interval_seconds))
        await session.commit()
    recording_interval = body.interval_seconds
    return {"interval_seconds": recording_interval}


@app.get("/api/readings", dependencies=[Depends(require_user)])
async def readings(from_time: AwareDatetime | None = Query(None, alias="from"),
                   to_time: AwareDatetime | None = Query(None, alias="to"),
                   limit: int = Query(2000, ge=1, le=5000)):
    if from_time and to_time and from_time.timestamp() > to_time.timestamp():
        raise HTTPException(422, "Start time must precede end time")
    query = select(EnergySample).order_by(EnergySample.recorded_at.desc()).limit(limit)
    if from_time:
        query = query.where(EnergySample.recorded_at >= from_time)
    if to_time:
        query = query.where(EnergySample.recorded_at <= to_time)
    async with SessionLocal() as session:
        rows = (await session.execute(query)).scalars().all()
    return [{"recorded_at": row.recorded_at.isoformat(), **{k: getattr(row, k) for k in SUMMARY_FIELDS}}
            for row in reversed(rows)]
