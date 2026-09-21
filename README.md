# Helio

A private, live-first dashboard for a Victron GX system. The interface includes an animated energy flow (with generator node), a five-metric overview row, battery gauge, live chart with stored 24h/7d history, searchable device telemetry, multi-user accounts with an admin People manager, light/dark theming, and a login page.

## Run locally

```bash
rtk docker compose -p victron-helio up -d --build
rtk docker compose -p victron-helio logs venus-backend
```

`COMPOSE_PROJECT_NAME=victron-helio` is pinned in `.env`; without it Compose creates a duplicate stack on the wrong ports.

Open http://localhost:8081. On first use, copy the **Helio first-use setup key** from the backend startup log into the setup form and choose a username and password (at least 12 characters). That account is the workspace owner (admin). Alternatively, supply `DASHBOARD_SETUP_TOKEN` through your secret environment before first startup. There is no default login. Keep the setup key private.

Use **Explore the demo** for a clearly labeled sample installation. Demo data never accesses your GX or database. The local stack binds only to loopback; production uses the existing HTTPS reverse proxy.

## GX connection

The GX lives at `192.168.21.10` on VLAN 21 (see `NETWORK_HANDOFF.md`). Current firmware serves MQTT only over **TLS on port 8883 with username/password**; anonymous access is rejected, port 1883 refuses connections, and port 80 `/websocket-mqtt` redirects to the web login. The broker certificate is self-signed, so the local stack runs with `MQTT_TLS_INSECURE=true` — traffic stays encrypted but the peer is not verified. Only do this on a trusted LAN.

Configure through `.env` (copy `.env.example`):

- `VENUS_HOST`, `VENUS_PORT`, `PORTAL_ID`: GX address, MQTT port and VRM portal ID.
- `MQTT_TRANSPORT`: `tcp` (used with 8883) or `websockets` (plain MQTT over WebSocket on 9001 if your GX allows it; set `MQTT_WS_PATH` accordingly).
- `MQTT_TLS=true` and `MQTT_TLS_INSECURE=true`: TLS with the self-signed-certificate exception.
- `MQTT_USERNAME` and `MQTT_PASSWORD`: the GX MQTT credentials (Settings → Services → MQTT on the GX). Never committed.

The collector subscribes to `N/<portal>/<service>/#` for system, battery, VE.Bus, solar charger, grid, generator (start/stop), genset, inverter, AC load, tank, temperature, charger and DC generator services. A keepalive is published every ~30 seconds and on reconnect to request telemetry bursts. It never sends control writes. Missing or stale values display a dash, never a fabricated zero. Device details include the original metric paths and identify stale readings.

Known data gaps on the current installation: no `grid` service exists (grid flows through the MultiPlus), and no genset reports state/power yet — the UI shows those as awaiting/not-reported rather than inventing numbers.

## Accounts

- The owner (first account) is admin: manages users under Settings → People, changes recording settings, resets or removes other accounts.
- Viewers can read every dashboard but cannot change settings or manage people.
- Every user can change their own password; admin resets revoke the affected user's sessions.
- Passwords use salted PBKDF2-SHA256 (600,000 iterations). Session tokens are random, hashed in PostgreSQL, bound to an account, revoked on logout and expire after 12 hours.

## Data and security

- Browser polling: 2 seconds; device explorer: 5 seconds.
- MQTT cache: at most 6,000 scalar telemetry paths. Readings expire after 90 seconds and are invalidated on reconnect.
- Live chart: 90 points at 10-second intervals, held in memory (15 minutes). Restarting clears this buffer.
- History: **15-minute summaries by default**, user-settable to off / 5 / 10 / 15 / 30 / 60 minutes. Snapshots store solar power, grid power, home power, battery power, generator power and charge percentage — sampled readings, not averages or energy totals.
- Existing `readings` and `settings` tables remain intact. The dashboard uses separate summary/settings tables; the history screen displays new summaries only.
- Appearance (light/dark/system) is per device, stored in localStorage; dark chart palettes are contrast- and CVD-validated.
- Cookies are HttpOnly and SameSite=Strict. Production forces Secure cookies; local HTTP uses `COOKIE_SECURE=false`.
- Mutations require a custom same-origin header; cross-origin API access is not enabled. Login and setup attempts are rate-limited in memory.
- Run a single backend worker/replica: telemetry buffers and the attempt limiter are process-local. Account/session data persists in PostgreSQL.

No password recovery is exposed publicly. An operator with database access must handle account recovery. HTTPS and a network route from the backend to the GX are required for production.

## Frontend development

```bash
rtk npm ci --prefix frontend
rtk npm run dev --prefix frontend
rtk npm run build --prefix frontend
```

The dev server proxies `/api` to the local Compose stack at port 8081. The frontend uses React, Recharts and Vite. The backend uses FastAPI, SQLAlchemy and Paho MQTT. No cloud telemetry service is required.

## Verification

Backend unit tests run with `python -m pytest backend/tests/test_collector.py` after installing `backend/requirements-dev.txt` and adding `backend` to `PYTHONPATH`. Integration tests additionally require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database whose name ends in `_test`. They reset only the Helio tables in that test database. A convenient pattern: `CREATE DATABASE venus_test` in the Compose Postgres, `docker cp backend/tests <backend-container>:/app/tests` (tests are docker-ignored), then run pytest inside the backend container.

The `playwright-tests` suite covers demo navigation, device search, chart controls, mobile layout and protected routes. Optional real-login coverage requires `HELIO_TEST_USERNAME` and `HELIO_TEST_PASSWORD` for a dedicated test account. `HELIO_BASE_URL` defaults to `http://localhost:8081`.
