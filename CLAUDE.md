# Victron Venus OS — Helio Dashboard

## Web Dashboard (Helio)
- **Local:** http://localhost:8081 (`docker compose up -d --build` — project name `victron-helio` is pinned in `.env` via `COMPOSE_PROJECT_NAME`)
- **Production:** https://victron.afrinam.com — plain compose stack (`-p venus`) at `/opt/labwhk/apps/venus` on `labwhk` (LAN `192.168.100.104`, SSH user `janj`), served by Dokploy's Traefik. **Deploy with `.claude/skills/deploying-to-production`** — merging to main does not ship.
- **GitHub:** `JanWHK/venus-dashboard`
- **Stack:** FastAPI + SQLAlchemy/asyncpg + Paho MQTT + React 18 + Recharts + PostgreSQL 15
- **Auth:** first-use setup key (printed in backend log on an empty DB) creates the owner/admin; admins can add viewer accounts under Settings → People
- **Test account (local dev only):** `jan` / `helio-dev-2026`; viewer `household` / `view-only-pass-1`. If login is rejected, the dev DB volume was likely recreated — re-create via the setup key in the backend log.

### Production env vars (`/opt/labwhk/apps/venus/.env` on labwhk, root-owned)
`DATABASE_URL` and `SYNC_DATABASE_URL` use `%40` for `@` in the password (URL encoding required).
The MQTT block (`VENUS_HOST=192.168.21.10`, `VENUS_PORT=8883`, `MQTT_TRANSPORT=tcp`, `MQTT_TLS=true`, `MQTT_TLS_INSECURE=true`, `MQTT_USERNAME`, `MQTT_PASSWORD`) matches local `.env` — the GX broker rejects anonymous connections.
If Postgres auth fails after redeployment, exec into `venus-db` and run:
`psql -U venus -d venus -c "ALTER ROLE venus WITH PASSWORD 'newpassword';"`
(The `venus_venus-db-data` named volume keeps the password from first init — changing the env var alone doesn't update it.)

## Device
- **URL:** http://192.168.21.10/gui-v1 (noVNC console) / http://192.168.21.10/gui-v2 (Qt WebAssembly UI)
- **Type:** Victron Venus OS GX device (NanoPi)
- **Network:** VLAN 21 (`192.168.21.0/24`) behind pfSense — see `NETWORK_HANDOFF.md`
- **Portal ID:** `c0619ab43e45`
- **MQTT:** `mqtts://192.168.21.10:8883` — TLS with username/password (`victron`).
  Broker uses a self-signed certificate, so the backend sets `MQTT_TLS_INSECURE=true`
  (CERT_NONE; LAN-only). Anonymous access and ports 1883/9001 are rejected or
  redirected on this firmware; port 80 `/websocket-mqtt` returns 302.
- **Credentials:** stored in `.env` (git-ignored) as `MQTT_USERNAME`/`MQTT_PASSWORD`. Never commit them.
- **Keepalive:** publish to `R/c0619ab43e45/keepalive` to trigger telemetry bursts.

## MQTT Services Actually Reporting (verified 2026-09-21/22)
| Device | Instance | Notes |
|---|---|---|
| system | `0` | aggregates; `Ac/Genset/L1/Power` populates **while the genset runs**; `Timers/TimeOnGenerator` |
| vebus (MultiPlus-II 48/5000/70) | `275` | AC out; AC-in lives under `Ac/ActiveIn/*` |
| solarcharger (SmartSolar MPPT 250/70 rev3) | `275` | VRM labels it MPPT-274/275; instance is 275 |
| battery (DYNESS-L) | `512` | SoC, voltage, current, temperature |

- **No `grid` service** — grid flows through the MultiPlus. **The genset is wired to
  AC input 0** (the slot configured as "grid"), so the input slot does not identify the
  source: the collector marks the input as generator whenever genset power exceeds
  `GENSET_MIN_WATTS` (20 W) and only then falls back to the slot role (0 = grid,
  1 = generator). `grid_power` is deliberately null while the generator feeds.
  When the genset is off, `ActiveInput` is 240 (nothing connected) and the grid card
  stays empty by design.
- **No `generator` service** (no `generator/0/State`) — runs are detected by reported
  genset power and the `Timers/TimeOnGenerator` counter; each run lands in
  `generator_runs` with exact duration, kWh and peak W (power telemetry works since
  2026-09-21). While the generator feeds, the UI shows a **Generator input** panel:
  total in = AC loads + DC loads (GX) + battery charging, where charging is the
  remainder so the identity is exact; the split bar carries percentage labels that
  always sum to 100 %.
- **Solar input panel** (2026-09-22, commit `a38419f`) — same split construction for
  the array while `solar_power > 0`: Total harvest = AC loads + DC loads + charging
  (remainder). Same segment colors as the generator panel (same destinations);
  heading shows PV V · A; hidden at night, matching the sun/moon icon rule. During a
  rare solar + genset overlap each panel's "charging" remainder includes both charge
  sources — acceptable, they are displays, not metering.
- `system/0/Ac/Consumption/L1/Power` ≡ vebus `Ac/Out/L1/P` (Home consumption = AC out).
  `Dc/System/Power` is a noisy GX DC aggregate (swings a few hundred W) — it feeds the
  panel's DC-loads line, so expect the tile to wobble.
- Genset output is not instantaneous either (swings ~500 W between 15 s samples); the
  AC-in ≈ loads + battery + DC + inverter-losses identity holds to ~4–6 %.

## Legacy logger (superseded — see OPEN_ISSUES.md)
`venus_logger.py` / `venus_discover.py` / `battery_log.xlsx` are the original Excel
logger. The cron job still points at `/usr/bin/python3`, which lacks `paho`/`openpyxl`,
so it fails every tick; `battery_log.xlsx` is stale since 2026-03-28. Helio replaces it.
Either delete the crontab line or reinstall the deps if the Excel export is still wanted.

## History recording
- `energy_samples` table: solar/grid/load/battery power, battery SoC, generator power,
  plus `ac_in_power`/`dc_load_power` (only since 2026-09-22 — older rows leave those
  series empty, which the Reports UI calls out).
- `generator_runs` table: one row per genset run — start/end, exact duration (Timers
  counter delta), kWh + peak W when power telemetry exists. Active run upserted every
  10 s; runs left open by a restart are closed at startup with `ended_at = updated_at`.
- Default every 15 minutes (user-settable in Settings: off / 5 / 10 / 15 / 30 / 60 min).
- Feeds the 24h/7d chart via `/api/readings`; live chart is memory-only (15 min).
- Reports (`backend/reports.py`, `GET /api/reports/{generator,solar,consumption}?from&to`):
  trapezoid integration over the summaries. The gap guard adapts to the median sample
  spacing (≤ 2.5×) — do NOT reuse the collector's fixed 180 s rule here, summaries are
  5–60 min apart and a fixed guard would discard every segment. The generator split
  integrates only over run windows; a generator report with no runs in range returns
  `energy: null` even when samples exist (by design).

## Gotchas
- `COMPOSE_PROJECT_NAME=victron-helio` lives in `.env` — plain `docker compose ...`
  without that file creates a duplicate `victron-*` stack on the wrong ports.
- Integration tests need `TEST_DATABASE_URL` ending in `_test`; easiest is inside the
  backend container against the compose DB (`CREATE DATABASE venus_test` first).
  `backend/.dockerignore` excludes `tests/`, so `docker cp` them in before running.
- Run a single backend replica: the live buffer and login rate limiter are process-local.
- Telemetry is read-only: only `R/<portal>/keepalive` is ever published, never `W/` topics.
