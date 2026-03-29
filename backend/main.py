import datetime
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, text

from collector import collect_reading
from database import Reading, SessionLocal, Setting, init_db, sync_engine, SyncSessionLocal

VALID_INTERVALS = [1, 5, 10, 20, 30, 60, 600, 1800, 3600]

scheduler = BackgroundScheduler()
_current_interval = 60


def _run_collection():
    # Wait just long enough to receive MQTT burst; cap at interval-1s, min 2s
    wait = max(2.0, min(3.0, _current_interval - 1))
    data = collect_reading(wait_seconds=wait)
    if not data:
        print("Collection returned no data", flush=True)
        return
    try:
        with SyncSessionLocal(sync_engine) as session:
            reading = Reading(**data)
            session.add(reading)
            session.commit()
        print(f"Saved reading: {data}", flush=True)
    except Exception as e:
        print(f"Save error: {e}", flush=True)


def _reschedule(interval_seconds: int):
    global _current_interval
    _current_interval = interval_seconds
    scheduler.remove_all_jobs()
    scheduler.add_job(_run_collection, "interval", seconds=interval_seconds, id="collect")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with SessionLocal() as session:
        result = await session.execute(select(Setting).limit(1))
        setting = result.scalar_one_or_none()
        interval = setting.interval_seconds if setting else 60
    _reschedule(interval)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SettingsIn(BaseModel):
    interval_seconds: int


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/settings")
async def get_settings():
    async with SessionLocal() as session:
        result = await session.execute(select(Setting).limit(1))
        setting = result.scalar_one_or_none()
        return {"interval_seconds": setting.interval_seconds if setting else 60}


@app.put("/api/settings")
async def update_settings(body: SettingsIn):
    if body.interval_seconds not in VALID_INTERVALS:
        raise HTTPException(400, f"interval_seconds must be one of {VALID_INTERVALS}")
    async with SessionLocal() as session:
        result = await session.execute(select(Setting).limit(1))
        setting = result.scalar_one_or_none()
        if setting:
            setting.interval_seconds = body.interval_seconds
        else:
            setting = Setting(interval_seconds=body.interval_seconds)
            session.add(setting)
        await session.commit()
    _reschedule(body.interval_seconds)
    return {"interval_seconds": body.interval_seconds}


@app.get("/api/readings")
async def get_readings(
    from_time: str = Query(None, alias="from"),
    to_time: str = Query(None, alias="to"),
    limit: int = Query(500, le=5000),
):
    async with SessionLocal() as session:
        query = select(Reading).order_by(Reading.recorded_at.desc()).limit(limit)
        if from_time:
            query = query.where(Reading.recorded_at >= datetime.datetime.fromisoformat(from_time.replace("Z", "+00:00")))
        if to_time:
            query = query.where(Reading.recorded_at <= datetime.datetime.fromisoformat(to_time.replace("Z", "+00:00")))
        result = await session.execute(query)
        rows = result.scalars().all()

    return [
        {
            "id": r.id,
            "recorded_at": r.recorded_at.isoformat(),
            "battery_soc": r.battery_soc,
            "battery_voltage": r.battery_voltage,
            "battery_current": r.battery_current,
            "ac_in_voltage": r.ac_in_voltage,
            "ac_in_current": r.ac_in_current,
            "ac_in_power": r.ac_in_power,
            "ac_in_frequency": r.ac_in_frequency,
            "ac_out_voltage": r.ac_out_voltage,
            "ac_out_current": r.ac_out_current,
            "ac_out_power": r.ac_out_power,
            "ac_out_frequency": r.ac_out_frequency,
            "solar_pv_voltage":   r.solar_pv_voltage,
            "solar_pv_current":   r.solar_pv_current,
            "solar_pv_power":     r.solar_pv_power,
            "solar_batt_voltage": r.solar_batt_voltage,
            "solar_batt_current": r.solar_batt_current,
            "solar_yield_total":  r.solar_yield_total,
            "solar_yield_system": r.solar_yield_system,
        }
        for r in reversed(rows)
    ]
