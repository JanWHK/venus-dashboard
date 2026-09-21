"""Read-only battery monitoring. Persist transitions, not telemetry samples.

Run one backend process, matching the collector's single-process deployment.
Network delivery runs separately from telemetry evaluation.
"""
import asyncio
import json
import logging
import math
import os
import smtplib
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from auth import require_admin, require_csrf_header, require_user
from collector import collector
from database import BatteryAlert, BatteryAlertRule, SessionLocal

THRESHOLDS = (50, 25, 15)
LABELS = {50: "Advisory", 25: "Warning", 15: "Critical"}
ACTIONS = {
    50: "Reduce nonessential loads and watch charging availability.",
    25: "Reduce loads now and arrange charging.",
    15: "Act now: reduce loads and restore charging to avoid loss of power.",
}
candidates = {}
last_check = None
router = APIRouter(prefix="/api/alerts")


def valid_soc(snapshot):
    value = snapshot.get("metrics", {}).get("battery_soc")
    return value if (snapshot.get("status") == "live" and
                     isinstance(value, (int, float)) and not isinstance(value, bool)
                     and math.isfinite(value) and 0 <= value <= 100) else None


def channels():
    return {
        "telegram": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "email": bool(os.getenv("SMTP_HOST") and os.getenv("ALERT_EMAIL_FROM") and os.getenv("ALERT_EMAIL_TO")),
    }


def message(row):
    return (f"Helio — {LABELS[row.threshold].upper()} battery alert\n"
            f"Battery {row.soc:.1f}% (threshold {row.threshold}%).\n"
            f"{ACTIONS[row.threshold]}\n"
            f"Observed: {row.last_notice_at.isoformat()}\n"
            f"Alert #{row.id}. Open Helio to acknowledge. No device controls were changed.")


def send_telegram(body):
    """Return a retry delay; never log provider errors containing bot credentials."""
    request = Request(
        f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
        data=json.dumps({"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": body}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            result = json.load(response)
    except HTTPError as error:
        try:
            result = json.load(error)
        except (ValueError, OSError):
            return False, 60
    except Exception:
        return False, 60
    if not isinstance(result, dict):
        return False, 60
    try:
        delay = max(60, int(result.get("parameters", {}).get("retry_after", 60)))
    except (TypeError, ValueError, AttributeError):
        delay = 60
    return result.get("ok") is True, delay


def send_email(body):
    mode = os.getenv("SMTP_SECURITY", "starttls")
    if mode not in ("starttls", "ssl"):
        return False
    context = ssl.create_default_context()
    client = smtplib.SMTP_SSL if mode == "ssl" else smtplib.SMTP
    options = {"timeout": 10}
    if mode == "ssl":
        options["context"] = context
    try:
        mail = EmailMessage()
        mail["Subject"] = body.splitlines()[0]
        mail["From"] = os.environ["ALERT_EMAIL_FROM"]
        mail["To"] = os.environ["ALERT_EMAIL_TO"]
        mail.set_content(body)
        with client(os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "465" if mode == "ssl" else "587")), **options) as smtp:
            if mode == "starttls":
                smtp.starttls(context=context)
            if os.getenv("SMTP_USERNAME"):
                smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(mail)
        return True
    except Exception:
        return False


async def evaluate(snapshot, now=None, monotonic=None):
    global last_check
    now = now or datetime.now(timezone.utc)
    clock = time.monotonic() if monotonic is None else monotonic
    soc = valid_soc(snapshot)
    if last_check is None or clock - last_check > 20 or clock < last_check:
        candidates.clear()
    last_check = clock
    if soc is None:
        candidates.clear()
        return
    async with SessionLocal() as session:
        rules = {r.threshold: r for r in (await session.scalars(select(BatteryAlertRule))).all()}
        for threshold in THRESHOLDS:
            if threshold not in rules:
                rules[threshold] = BatteryAlertRule(threshold=threshold, armed=True)
                session.add(rules[threshold])
        active = (await session.scalars(select(BatteryAlert).where(BatteryAlert.resolved_at.is_(None)))).all()
        for row in active:
            if soc > row.threshold + 5:
                row.resolved_at = now
                if row.delivery == "pending":
                    row.delivery = "cancelled"
        crossed = []
        for threshold, rule in rules.items():
            if soc > threshold + 5:
                rule.armed = True
            if rule.armed and soc <= threshold:
                candidates.setdefault(threshold, clock)
                if clock - candidates[threshold] >= 30:
                    crossed.append(threshold)
            else:
                candidates.pop(threshold, None)
        if crossed:
            threshold = min(crossed)
            # A sudden drop produces one strongest alert, not three messages.
            for level in THRESHOLDS:
                if level >= threshold:
                    rules[level].armed = False
                    candidates.pop(level, None)
            session.add(BatteryAlert(threshold=threshold, soc=soc, created_at=now,
                                     last_notice_at=now, next_attempt_at=now))
            for row in active:
                if row.threshold > threshold and row.delivery == "pending":
                    row.delivery = "superseded"
        for row in active:
            if (row.threshold == 15 and not row.resolved_at and not row.acknowledged_at
                    and soc <= 20 and (now - row.last_notice_at).total_seconds() >= 600
                    and row.delivery != "pending"):
                row.soc = soc
                row.last_notice_at = now
                row.next_attempt_at = now
                row.attempts = 0
                row.telegram, row.email, row.delivery = "pending", "standby", "pending"
        await session.commit()


async def deliver_pending(now=None):
    now = now or datetime.now(timezone.utc)
    # Do not send apparently current low-battery warnings using stale telemetry.
    soc = valid_soc(collector.snapshot())
    if soc is None:
        return
    async with SessionLocal() as session:
        rows = (await session.scalars(select(BatteryAlert).where(
            BatteryAlert.delivery == "pending", BatteryAlert.resolved_at.is_(None),
            BatteryAlert.next_attempt_at <= now).order_by(BatteryAlert.threshold).limit(3))).all()
        configured = channels()
        for row in rows:
            if soc > row.threshold + 5 or (now - row.last_notice_at).total_seconds() > 3600:
                row.delivery = "expired"
                continue
            body = message(row)
            ok, delay = await asyncio.to_thread(send_telegram, body) if configured["telegram"] else (False, 60)
            row.telegram = "sent" if ok else "failed" if configured["telegram"] else "not_configured"
            if not ok:
                email_ok = await asyncio.to_thread(send_email, body) if configured["email"] else False
                row.email = "sent" if email_ok else "failed" if configured["email"] else "not_configured"
                ok = email_ok
            row.attempts += 1
            row.delivery = "sent" if ok else "failed" if row.attempts >= 3 else "pending"
            row.next_attempt_at = now + timedelta(seconds=max(delay, 60 * row.attempts))
        await session.commit()


async def delivery_loop():
    while True:
        try:
            await deliver_pending()
        except Exception:
            # Do not include request URLs or credentials in logs.
            logging.getLogger("uvicorn.error").error("Battery notification delivery could not complete")
        await asyncio.sleep(5)


def payload(row):
    return {"id": row.id, "threshold": row.threshold, "soc": row.soc,
            "severity": LABELS[row.threshold].lower(), "action": ACTIONS[row.threshold],
            "created_at": row.created_at, "last_notice_at": row.last_notice_at,
            "resolved_at": row.resolved_at, "acknowledged_at": row.acknowledged_at,
            "delivery": row.delivery, "telegram": row.telegram, "email": row.email}


@router.get("", dependencies=[Depends(require_user)])
async def status():
    async with SessionLocal() as session:
        active = (await session.scalars(select(BatteryAlert).where(
            BatteryAlert.resolved_at.is_(None)).order_by(BatteryAlert.threshold))).all()
        recent = (await session.scalars(select(BatteryAlert).order_by(BatteryAlert.id.desc()).limit(20))).all()
    return {"active": [payload(row) for row in active], "recent": [payload(row) for row in recent],
            "channels": channels(), "soc": valid_soc(collector.snapshot())}


@router.post("/{alert_id}/acknowledge", dependencies=[Depends(require_csrf_header)])
async def acknowledge(alert_id: int, user=Depends(require_admin)):
    async with SessionLocal() as session:
        row = await session.get(BatteryAlert, alert_id)
        if row is None:
            raise HTTPException(404, "Alert not found")
        row.acknowledged_at = row.acknowledged_at or datetime.now(timezone.utc)
        if row.delivery == "pending":
            row.delivery = "cancelled"
        await session.commit()
    return {"ok": True}
