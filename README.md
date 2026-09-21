# Helio

A private, live-first dashboard for a Victron GX system. The interface includes an animated energy flow, battery gauge, live chart, searchable device telemetry, optional energy history, and a login page.

## Run locally

```bash
rtk docker compose -p victron-helio up -d --build
rtk docker compose -p victron-helio logs venus-backend
```

Open http://localhost:8081. On first use, copy the **Helio first-use setup key** from the backend startup log into the setup form and choose a username and password (at least 12 characters). The setup key only works before an account exists. Alternatively, supply `DASHBOARD_SETUP_TOKEN` through your secret environment before first startup. There is no default login. Keep the setup key private.

Use **Explore the demo** for a clearly labeled sample installation. Demo data never accesses your GX or database. The local stack binds only to loopback; production uses the existing HTTPS reverse proxy.

## GX connection

The default host is `192.168.21.10`, using MQTT over WebSockets on port 80. Configure the following through the environment:

- `VENUS_HOST`, `VENUS_PORT`, `PORTAL_ID`: GX address and VRM portal ID.
- `MQTT_TRANSPORT`: `websockets` or `tcp` (set `VENUS_PORT=1883` for plain MQTT).
- `MQTT_TLS=true`: enable certificate-verified TLS; use the matching TLS port.
- `MQTT_USERNAME` and `MQTT_PASSWORD`: optional MQTT broker credentials.

The collector requests `N/<portal>/<service>/#` for system, battery, VE.Bus, solar charger, grid, generator, inverter, load, tank, temperature, charger and DC generator services. It requests a fresh telemetry burst every 30 seconds and reconnects automatically. It never sends control writes. Confirm the portal ID belongs to this GX; the default is inherited from the previous installation.

At development time, this GX answered HTTP but redirected `/websocket-mqtt` to its web login; ports 1883 and 8883 refused connections. MQTT access must be enabled/configured on the GX before live telemetry can be verified. MQTT credentials do not authenticate the GX's web login page. A web-session-only endpoint needs a different supported MQTT connection configuration.

System aggregate topics are preferred. Solar power includes available DC and AC solar sources. Battery topics fall back to the first reporting battery service when a system aggregate is unavailable. Missing or stale values display a dash, never a fabricated zero. Device details include the original metric paths and identify stale readings.

## Data and security

- Browser polling: 2 seconds; device explorer: 5 seconds.
- MQTT cache: at most 6,000 scalar telemetry paths. Readings expire after 90 seconds and are invalidated on reconnect.
- Live chart: 90 points at 10-second intervals, held in memory (15 minutes). Restarting clears this buffer.
- History: off by default. Optional 5-, 10-, 30- or 60-minute snapshots store only solar power, grid power, home power, battery power and charge percentage. These are sampled readings, not averages or energy totals.
- Existing `readings` and `settings` tables remain intact. The new dashboard uses separate summary/settings tables; the history screen displays new summaries only.
- Passwords use salted PBKDF2-SHA256 (600,000 iterations). Session tokens are random, hashed in PostgreSQL, revoked on logout and expire after 12 hours.
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

Backend unit tests run with `python -m pytest backend/tests/test_collector.py` after installing `backend/requirements-dev.txt` and adding `backend` to `PYTHONPATH`. Integration tests additionally require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database whose name ends in `_test`. They reset only the Helio tables in that test database.

The `playwright-tests` suite covers demo navigation, device search, chart controls, mobile layout and protected routes. Optional real-login coverage requires `HELIO_TEST_USERNAME` and `HELIO_TEST_PASSWORD` for a dedicated test account. `HELIO_BASE_URL` defaults to `http://localhost:8081`.
