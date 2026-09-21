import os
import datetime
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy import Column, BigInteger, Integer, Float, DateTime, String, Boolean, text

DATABASE_URL = os.environ["DATABASE_URL"]
SYNC_DATABASE_URL = os.environ.get(
    "SYNC_DATABASE_URL",
    DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://"),
)

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

sync_engine = create_engine(SYNC_DATABASE_URL, echo=False)
SyncSessionLocal = Session


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "dashboard_account"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), nullable=False)
    password_hash = Column(String(200), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")


class LoginSession(Base):
    __tablename__ = "dashboard_sessions"
    token_hash = Column(String(64), primary_key=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    account_id = Column(Integer)


class DashboardSetting(Base):
    __tablename__ = "dashboard_settings"
    id = Column(Integer, primary_key=True)
    interval_seconds = Column(Integer, nullable=False, default=900)


class EnergySample(Base):
    __tablename__ = "energy_samples"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, index=True)
    solar_power = Column(Float)
    grid_power = Column(Float)
    load_power = Column(Float)
    battery_power = Column(Float)
    battery_soc = Column(Float)
    generator_power = Column(Float)


class BatteryAlertRule(Base):
    __tablename__ = "battery_alert_rules"
    threshold = Column(Integer, primary_key=True)
    armed = Column(Boolean, nullable=False, default=True)


class BatteryAlert(Base):
    __tablename__ = "battery_alerts"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    threshold = Column(Integer, nullable=False)
    soc = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True))
    acknowledged_at = Column(DateTime(timezone=True))
    last_notice_at = Column(DateTime(timezone=True), nullable=False)
    next_attempt_at = Column(DateTime(timezone=True), nullable=False, index=True)
    attempts = Column(Integer, nullable=False, default=0)
    telegram = Column(String(24), nullable=False, default="pending")
    email = Column(String(24), nullable=False, default="standby")
    delivery = Column(String(24), nullable=False, default="pending")


class GeneratorRun(Base):
    __tablename__ = "generator_runs"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    started_at = Column(DateTime(timezone=True), nullable=False, index=True)
    # NULL while the run is still in progress.
    ended_at = Column(DateTime(timezone=True))
    duration_seconds = Column(Float)
    energy_kwh = Column(Float)
    peak_power_w = Column(Float)
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=text("NOW()"))


class Setting(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True)
    interval_seconds = Column(Integer, nullable=False, default=60)
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class Reading(Base):
    __tablename__ = "readings"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    battery_soc = Column(Float)
    battery_voltage = Column(Float)
    battery_current = Column(Float)
    ac_in_voltage = Column(Float)
    ac_in_current = Column(Float)
    ac_in_power = Column(Float)
    ac_in_frequency = Column(Float)
    ac_out_voltage = Column(Float)
    ac_out_current = Column(Float)
    ac_out_power = Column(Float)
    ac_out_frequency = Column(Float)
    solar_pv_voltage   = Column(Float)
    solar_pv_current   = Column(Float)
    solar_pv_power     = Column(Float)
    solar_batt_voltage = Column(Float)
    solar_batt_current = Column(Float)
    solar_yield_total  = Column(Float)
    solar_yield_system = Column(Float)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_readings_recorded_at
            ON readings (recorded_at DESC)
        """))
        for col in ["solar_pv_voltage", "solar_pv_current", "solar_pv_power",
                    "solar_batt_voltage", "solar_batt_current",
                    "solar_yield_total", "solar_yield_system"]:
            await conn.execute(text(
                f"ALTER TABLE readings ADD COLUMN IF NOT EXISTS {col} FLOAT"
            ))
        await conn.execute(text(
            "ALTER TABLE dashboard_account ADD COLUMN IF NOT EXISTS role VARCHAR(20)"
        ))
        await conn.execute(text(
            "UPDATE dashboard_account SET role = 'admin' WHERE id = 1 AND (role IS NULL OR role = '')"
        ))
        await conn.execute(text(
            "UPDATE dashboard_account SET role = 'viewer' WHERE role IS NULL OR role = ''"
        ))
        await conn.execute(text(
            "ALTER TABLE dashboard_sessions ADD COLUMN IF NOT EXISTS account_id INTEGER"
        ))
        await conn.execute(text(
            "ALTER TABLE energy_samples ADD COLUMN IF NOT EXISTS generator_power FLOAT"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_account_username ON dashboard_account (username)"
        ))
    # Insert default settings row if missing
    async with SessionLocal() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM settings"))
        if result.scalar() == 0:
            await session.execute(text("INSERT INTO settings (interval_seconds) VALUES (60)"))
            await session.commit()
