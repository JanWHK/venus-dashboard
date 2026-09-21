"""Integration tests require a disposable PostgreSQL database ending in _test."""
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

test_url = os.getenv("TEST_DATABASE_URL")
if not test_url:
    pytest.skip("Set TEST_DATABASE_URL to run PostgreSQL integration tests", allow_module_level=True)
if not test_url.rsplit("/", 1)[-1].endswith("_test"):
    raise RuntimeError("Refusing to reset a database without the _test suffix")
os.environ["DATABASE_URL"] = test_url
os.environ["SYNC_DATABASE_URL"] = test_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
os.environ["COOKIE_SECURE"] = "false"
os.environ["DASHBOARD_SETUP_TOKEN"] = "integration-test-setup-key"

from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

import auth
import main
from database import Account, DashboardSetting, EnergySample, LoginSession, BatteryAlert, BatteryAlertRule, sync_engine

HEADERS = {"X-Helio-Request": "1"}
CREDENTIALS = {"username": "owner", "password": "test-only-long-password"}


@pytest.fixture
def client():
    auth.attempts.clear()
    main.live_history.clear()
    async def idle():
        import asyncio
        await asyncio.Event().wait()
    # Tests drive the evaluator explicitly; never send real notifications.
    with patch.object(main.collector, "start"), patch.object(main.collector, "stop"), \
            patch.object(main, "run_telemetry", idle), patch.object(main.alerts, "delivery_loop", idle):
        with TestClient(main.app) as client:
            # This code is gated above to the explicitly supplied disposable test database.
            with Session(sync_engine) as session:
                for table in [LoginSession, Account, DashboardSetting, EnergySample, BatteryAlert, BatteryAlertRule]:
                    session.execute(delete(table))
                session.commit()
            auth.setup_token = os.environ["DASHBOARD_SETUP_TOKEN"]
            main.recording_interval = 0
            yield client


def create_owner(client):
    response = client.post("/api/auth/setup", json={**CREDENTIALS, "setup_key": os.environ["DASHBOARD_SETUP_TOKEN"]}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response


def test_all_telemetry_endpoints_require_authentication(client):
    for path in ["/api/live", "/api/devices", "/api/settings", "/api/readings", "/api/auth/me", "/api/alerts"]:
        assert client.get(path).status_code == 401
    assert client.put("/api/settings", json={"interval_seconds": 300}, headers=HEADERS).status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.post("/api/alerts/1/acknowledge", headers=HEADERS).status_code == 401


def test_setup_requires_key_and_strong_password_and_cannot_repeat(client):
    assert client.get("/api/auth/status").json()["setup_required"]
    assert client.post("/api/auth/setup", json={**CREDENTIALS, "setup_key": "wrong"}, headers=HEADERS).status_code == 403
    assert client.post("/api/auth/setup", json={**CREDENTIALS, "setup_key": "invalid-\u00e9"}, headers=HEADERS).status_code == 403
    assert client.post("/api/auth/setup", json={**CREDENTIALS, "password": "short", "setup_key": "integration-test-setup-key"}, headers=HEADERS).status_code == 422
    response = create_owner(client)
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert not client.get("/api/auth/status").json()["setup_required"]
    assert client.post("/api/auth/setup", json={**CREDENTIALS, "setup_key": "integration-test-setup-key"}, headers=HEADERS).status_code == 403
    with Session(sync_engine) as session:
        assert session.get(Account, 1).password_hash != CREDENTIALS["password"]


def test_logout_revokes_copied_cookie_and_login_checks_password(client):
    create_owner(client)
    cookie = client.cookies.get(auth.COOKIE)
    assert client.get("/api/auth/me").json() == {"id": 1, "username": "owner", "role": "admin"}
    assert client.post("/api/auth/logout", headers=HEADERS).status_code == 200
    assert client.get("/api/live", headers={"Cookie": f"{auth.COOKIE}={cookie}"}).status_code == 401
    assert client.post("/api/auth/login", json={**CREDENTIALS, "password": "wrong"}, headers=HEADERS).status_code == 401
    assert client.post("/api/auth/login", json=CREDENTIALS, headers=HEADERS).status_code == 200
    assert client.get("/api/live").status_code == 200


def test_expired_session_rejected(client):
    create_owner(client)
    with Session(sync_engine) as session:
        for login in session.query(LoginSession):
            login.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_header_and_login_throttling(client):
    assert client.post("/api/auth/login", json=CREDENTIALS).status_code == 403
    for _ in range(10):
        assert client.post("/api/auth/login", json=CREDENTIALS, headers=HEADERS).status_code == 401
    response = client.post("/api/auth/login", json=CREDENTIALS, headers=HEADERS)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "300"


def test_summary_settings_validation_and_persistence(client):
    create_owner(client)
    assert client.get("/api/settings").json()["interval_seconds"] == 0
    assert client.put("/api/settings", json={"interval_seconds": 300}).status_code == 403
    assert client.put("/api/settings", json={"interval_seconds": 1}, headers=HEADERS).status_code == 422
    assert client.put("/api/settings", json={"interval_seconds": 300}, headers=HEADERS).status_code == 200
    with Session(sync_engine) as session:
        assert session.get(DashboardSetting, 1).interval_seconds == 300
    assert client.get("/api/settings").json()["interval_seconds"] == 300
    assert client.get("/api/readings?limit=-1").status_code == 422
    assert client.get("/api/readings?from=invalid").status_code == 422
    assert client.get("/api/readings?from=2026-09-21T10:00:00").status_code == 422
    assert client.get("/api/readings").json() == []
    assert client.get("/api/live").headers["cache-control"] == "no-store"


def test_history_sorted_and_filtered(client):
    create_owner(client)
    now = datetime.now(timezone.utc)
    with Session(sync_engine) as session:
        session.add(EnergySample(recorded_at=now - timedelta(hours=2), solar_power=100))
        session.add(EnergySample(recorded_at=now - timedelta(minutes=10), solar_power=200))
        session.commit()
    rows = client.get("/api/readings").json()
    assert [row["solar_power"] for row in rows] == [100, 200]
    rows = client.get("/api/readings", params={"from": (now - timedelta(hours=1)).isoformat()}).json()
    assert [row["solar_power"] for row in rows] == [200]


def test_secure_cookie_configuration(client, monkeypatch):
    monkeypatch.setattr(auth, "SECURE", True)
    response = create_owner(client)
    assert "Secure" in response.headers["set-cookie"]


def test_only_live_compact_summaries_are_written(client):
    metrics = {"solar_power": 1500, "battery_soc": 80, "battery_temperature": 28, "private_detail": "not persisted"}
    assert not client.portal.call(main.save_summary, {"status": "offline", "metrics": metrics})
    assert not client.portal.call(main.save_summary, {"status": "live", "metrics": {}})
    assert client.portal.call(main.save_summary, {"status": "live", "metrics": metrics})
    with Session(sync_engine) as session:
        rows = session.query(EnergySample).all()
        assert len(rows) == 1
        assert rows[0].solar_power == 1500
        assert rows[0].battery_soc == 80
        assert rows[0].grid_power is None
        assert not hasattr(rows[0], "battery_temperature")


def login_as(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response


def test_owner_manages_viewers(client):
    create_owner(client)
    viewer_credentials = {"username": "family", "password": "viewer-long-password"}
    assert client.get("/api/auth/users", headers=HEADERS).json() == [
        {"id": 1, "username": "owner", "role": "admin"}]
    assert client.post("/api/auth/users", json={**viewer_credentials, "password": "short"}, headers=HEADERS).status_code == 422
    created = client.post("/api/auth/users", json={**viewer_credentials, "role": "viewer"}, headers=HEADERS)
    assert created.status_code == 200, created.text
    viewer_id = created.json()["id"]
    assert client.post("/api/auth/users", json={**viewer_credentials, "role": "viewer"}, headers=HEADERS).status_code == 409
    login_as(client, **viewer_credentials)
    assert client.get("/api/auth/me").json()["role"] == "viewer"
    assert client.get("/api/live").status_code == 200
    assert client.get("/api/readings").status_code == 200
    assert client.get("/api/auth/users").status_code == 403
    assert client.put("/api/settings", json={"interval_seconds": 900}, headers=HEADERS).status_code == 403
    assert client.post("/api/auth/users", json={**viewer_credentials, "role": "viewer"}, headers=HEADERS).status_code == 403
    assert client.delete(f"/api/auth/users/{viewer_id}", headers=HEADERS).status_code == 403
    assert client.delete("/api/auth/users/1", headers=HEADERS).status_code == 403


def test_owner_cannot_delete_self_or_the_owner_account(client):
    create_owner(client)
    assert client.delete("/api/auth/users/1", headers=HEADERS).status_code == 403
    assert client.delete("/api/auth/users/99999", headers=HEADERS).status_code == 404
    created = client.post("/api/auth/users", json={"username": "temp", "password": "temp-long-password"}, headers=HEADERS)
    assert client.delete(f"/api/auth/users/{created.json()['id']}", headers=HEADERS).status_code == 200
    assert client.post("/api/auth/login", json={"username": "temp", "password": "temp-long-password"}, headers=HEADERS).status_code == 401


def test_admin_reset_revokes_sessions_and_changes_password(client):
    create_owner(client)
    created = client.post("/api/auth/users", json={"username": "family", "password": "viewer-long-password"}, headers=HEADERS)
    viewer_id = created.json()["id"]
    client.cookies.clear()
    login_as(client, "family", "viewer-long-password")
    viewer_cookie = client.cookies.get(auth.COOKIE)
    client.cookies.clear()
    login_as(client, "owner", CREDENTIALS["password"])
    assert client.put(f"/api/auth/users/{viewer_id}/password", json={"new_password": "brand-new-long-password"}, headers=HEADERS).status_code == 200
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, viewer_cookie)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "family", "password": "viewer-long-password"}, headers=HEADERS).status_code == 401
    assert client.post("/api/auth/login", json={"username": "family", "password": "brand-new-long-password"}, headers=HEADERS).status_code == 200


def test_users_change_their_own_password(client):
    create_owner(client)
    assert client.put("/api/auth/me/password", json={"current_password": "wrong", "new_password": "replacement-password"}, headers=HEADERS).status_code == 401
    assert client.put("/api/auth/me/password", json={"current_password": CREDENTIALS["password"], "new_password": "replacement-password"}, headers=HEADERS).status_code == 200
    client.cookies.clear()
    assert client.post("/api/auth/login", json={**CREDENTIALS, "password": CREDENTIALS["password"]}, headers=HEADERS).status_code == 401
    assert client.post("/api/auth/login", json={"username": "owner", "password": "replacement-password"}, headers=HEADERS).status_code == 200


def test_fifteen_minute_interval_is_valid(client):
    create_owner(client)
    assert client.put("/api/settings", json={"interval_seconds": 900}, headers=HEADERS).status_code == 200
    assert client.get("/api/settings").json()["interval_seconds"] == 900
