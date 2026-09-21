"""Alert integration tests use the existing disposable PostgreSQL fixture."""
import io
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError

import pytest
from test_api import client, create_owner, login_as, HEADERS
from sqlalchemy.orm import Session

import alerts
from database import BatteryAlert, sync_engine

BASE = datetime(2026, 9, 21, tzinfo=timezone.utc)


def snapshot(soc, status="live"):
    return {"status": status, "metrics": {"battery_soc": soc}}


def evaluate(client, soc, seconds, status="live"):
    client.portal.call(alerts.evaluate, snapshot(soc, status), BASE + timedelta(seconds=seconds), seconds)


def cross(client, soc, start=0):
    for seconds in range(start, start + 31, 10):
        evaluate(client, soc, seconds)


def rows():
    with Session(sync_engine) as session:
        return session.query(BatteryAlert).order_by(BatteryAlert.id).all()


@pytest.mark.parametrize("soc", [None, True, -1, 101, float("nan"), float("inf"), "15"])
def test_invalid_soc(client, soc):
    cross(client, soc)
    assert rows() == []


@pytest.mark.parametrize("threshold", [50, 25, 15])
def test_threshold_debounce_and_dedup(client, threshold):
    for seconds in (0, 10, 20):
        evaluate(client, threshold, seconds)
    assert rows() == []
    evaluate(client, threshold, 30)
    assert [row.threshold for row in rows()] == [threshold]
    cross(client, threshold, 40)
    assert len(rows()) == 1
    # A process restart forgets debounce, but not fired thresholds.
    alerts.candidates.clear()
    alerts.last_check = None
    cross(client, threshold, 80)
    assert len(rows()) == 1


def test_progressive_alerts_and_hysteresis(client):
    cross(client, 50)
    cross(client, 25, 40)
    cross(client, 15, 80)
    assert [row.threshold for row in rows()] == [50, 25, 15]
    evaluate(client, 20, 120)
    assert rows()[-1].resolved_at is None
    evaluate(client, 21, 130)
    assert rows()[-1].resolved_at is not None
    cross(client, 15, 140)
    assert [row.threshold for row in rows()] == [50, 25, 15, 15]


def test_stale_and_interrupted_samples_reset_debounce(client):
    evaluate(client, 15, 0)
    evaluate(client, 15, 10, "offline")
    evaluate(client, 15, 20)
    evaluate(client, 15, 30)
    assert rows() == []
    evaluate(client, 15, 100)  # long sampling gap is not continuous evidence
    assert rows() == []
    evaluate(client, 51, 110)
    cross(client, 15, 120)
    assert len(rows()) == 1


def test_acknowledgement_requires_admin_and_csrf(client):
    cross(client, 15)
    create_owner(client)
    row = rows()[0]
    assert client.post(f"/api/alerts/{row.id}/acknowledge").status_code == 403
    assert client.post("/api/alerts/999999/acknowledge", headers=HEADERS).status_code == 404
    viewer = {"username": "reader", "password": "viewer-long-password"}
    client.post("/api/auth/users", json=viewer, headers=HEADERS)
    login_as(client, **viewer)
    assert client.get("/api/alerts").status_code == 200
    assert client.post(f"/api/alerts/{row.id}/acknowledge", headers=HEADERS).status_code == 403
    login_as(client, "owner", "test-only-long-password")
    assert client.post(f"/api/alerts/{row.id}/acknowledge", headers=HEADERS).status_code == 200
    assert rows()[0].acknowledged_at is not None
    assert rows()[0].delivery == "cancelled"
    evaluate(client, 15, 700)
    assert rows()[0].delivery == "cancelled"


@pytest.mark.parametrize("telegram_ok,email_ok,expected", [(True, True, "sent"), (False, True, "sent"), (False, False, "pending")])
def test_telegram_primary_email_backup(client, telegram_ok, email_ok, expected):
    cross(client, 25)
    with patch.object(alerts.collector, "snapshot", return_value=snapshot(25)), \
            patch.object(alerts, "channels", return_value={"telegram": True, "email": True}), \
            patch.object(alerts, "send_telegram", return_value=(telegram_ok, 120)) as telegram, \
            patch.object(alerts, "send_email", return_value=email_ok) as email:
        client.portal.call(alerts.deliver_pending, BASE + timedelta(seconds=31))
    assert telegram.call_count == 1
    assert email.call_count == (0 if telegram_ok else 1)
    assert rows()[0].delivery == expected
    assert rows()[0].next_attempt_at == BASE + timedelta(seconds=151)


def test_delivery_pauses_when_stale_and_retries_are_bounded(client):
    cross(client, 15)
    with patch.object(alerts.collector, "snapshot", return_value=snapshot(None)):
        client.portal.call(alerts.deliver_pending, BASE + timedelta(seconds=31))
    assert rows()[0].attempts == 0
    with patch.object(alerts.collector, "snapshot", return_value=snapshot(15)), \
            patch.object(alerts, "channels", return_value={"telegram": False, "email": False}):
        for second in (31, 91, 211):
            client.portal.call(alerts.deliver_pending, BASE + timedelta(seconds=second))
    assert rows()[0].delivery == "failed"
    assert rows()[0].telegram == "not_configured"
    evaluate(client, 17, 629)
    assert rows()[0].delivery == "failed"
    evaluate(client, 17, 630)
    assert rows()[0].delivery == "pending"
    assert rows()[0].attempts == 0
    evaluate(client, 21, 640)
    assert rows()[0].delivery == "cancelled"


def test_telegram_api_json_and_rate_limit(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123")
    with patch.object(alerts, "urlopen", return_value=io.BytesIO(b'{"ok":true}')) as request:
        assert alerts.send_telegram("test message") == (True, 60)
        assert json.loads(request.call_args.args[0].data) == {"chat_id": "123", "text": "test message"}
    error = HTTPError("redacted", 429, "rate limited", {}, io.BytesIO(b'{"ok":false,"parameters":{"retry_after":300}}'))
    with patch.object(alerts, "urlopen", side_effect=error):
        assert alerts.send_telegram("test") == (False, 300)


def test_email_requires_tls_and_uses_configured_recipient(client, monkeypatch):
    for key, value in {"SMTP_HOST": "smtp.example.test", "SMTP_USERNAME": "test", "SMTP_PASSWORD": "secret",
                       "ALERT_EMAIL_FROM": "from@example.test", "ALERT_EMAIL_TO": "to@example.test"}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("SMTP_SECURITY", "starttls")
    with patch.object(alerts.smtplib, "SMTP") as smtp:
        assert alerts.send_email("Test alert\nBody")
        connection = smtp.return_value.__enter__.return_value
        connection.starttls.assert_called_once()
        connection.login.assert_called_once_with("test", "secret")
        assert connection.send_message.call_args.args[0]["To"] == "to@example.test"
    monkeypatch.setenv("SMTP_SECURITY", "none")
    assert not alerts.send_email("Test")
