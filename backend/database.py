import os
import datetime
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy import Column, BigInteger, Integer, Float, DateTime, text

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


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_readings_recorded_at
            ON readings (recorded_at DESC)
        """))
    # Insert default settings row if missing
    async with SessionLocal() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM settings"))
        if result.scalar() == 0:
            await session.execute(text("INSERT INTO settings (interval_seconds) VALUES (60)"))
            await session.commit()
