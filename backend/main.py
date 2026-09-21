import asyncio
import logging
import time
from collections import deque
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select

from auth import initialize_auth, require_admin, require_csrf_header, require_user, router as auth_router
from collector import collector
from database import DashboardSetting, EnergySample, SessionLocal, engine, init_db

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
        now = time.monotonic()
        if recording_interval and now - last_saved >= recording_interval:
            last_saved = now
            try:
                await save_summary(snapshot)
            except Exception:
                logging.getLogger("uvicorn.error").exception("Could not save energy summary")
        await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global recording_interval
    await init_db()
    await initialize_auth()
    async with SessionLocal() as session:
        setting = await session.get(DashboardSetting, 1)
        recording_interval = setting.interval_seconds if setting else 900
    collector.start()
    task = asyncio.create_task(run_telemetry())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await asyncio.to_thread(collector.stop)
        await engine.dispose()


app = FastAPI(title="Helio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(auth_router)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/live", dependencies=[Depends(require_user)])
async def live():
    return {**collector.snapshot(), "history": list(live_history), "recording_interval": recording_interval}


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
