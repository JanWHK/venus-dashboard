# Agent Handoff — Helio / Victron Dashboard

> Written 2026-09-21 for the next agent. Read this plus `AGENTS.md` (workflow rules),
> `CLAUDE.md` (device/config facts), `OPEN_ISSUES.md` (live issue list) and
> `NETWORK_HANDOFF.md` (VLAN 21 work — still has an open checklist).

## What this project is

A private dashboard ("Helio") for a Victron Venus GX. FastAPI backend subscribes to the
GX's MQTT broker (read-only) and serves a React dashboard. Replaced an older Excel
logger (`venus_logger.py`, `battery_log.xlsx` — legacy, broken, see OPEN_ISSUES.md).

**Current state: fully working on the local stack.** Live GX telemetry, 15-minute
history recording, multi-user accounts (admin + viewers), generator card/series (data
pending a physical genset), light/dark theming. All on branch
`feature/solar-mppt-mobile-responsive`, committed through `f2ac015`. Nothing is pushed
or merged to `main` yet; no PR exists.

## Running it

```bash
docker compose up -d --build        # project name victron-helio comes from .env
docker compose logs -f venus-backend
```

- Dashboard: http://localhost:8081 (loopback only).
- Local dev login: `jan` / `helio-dev-2026` (owner); viewer: `household` / `view-only-pass-1`.
- A second, older test stack (`victron-helio-browser-*` on port 8082, plain docker run,
  DB `helio_test`) has **no MQTT config** — it can never show live data. It exists for
  Playwright integration runs; consider removing it if unused.

### Gotchas that have bitten before

1. **Compose project name**: `.env` pins `COMPOSE_PROJECT_NAME=victron-helio`. Running
   plain `docker compose` without that file (or from another directory) creates a
   duplicate `victron-*` stack. Check `docker ps` before assuming.
2. **MQTT endpoint**: this GX firmware only serves MQTT over TLS on port **8883** with
   username/password (`victron` / value in `.env`). Port 80 `/websocket-mqtt` 302s;
   1883/9001 refuse or reject. The certificate is self-signed → `MQTT_TLS_INSECURE=true`
   (encrypted, unverified peer — trusted LAN only).
3. **Compose env forwarding**: variables must be declared in the compose `environment:`
   block AND set in `.env`. A var that exists only in `.env` is invisible to the
   container (this silently broke TLS once).
4. **Single backend replica**: the live buffer and login rate-limiter are process-local.

## Data shapes worth knowing

- Services subscribed: `system, battery, vebus, solarcharger, grid, genset, inverter,
  acload, tank, temperature, charger, dcgenset, generator` — `N/<portal>/<service>/#`.
- Reporting devices right now: `system/0`, `vebus/275`, `solarcharger/275`,
  `battery/512`. **No `grid` service and no `generator` topics** — the UI deliberately
  shows dashes/"Not reported" instead of fabricating values (see OPEN_ISSUES.md for the
  two data-gap options: vebus AC-in grid fallback, or wait for a genset).
- Keepalive `R/<portal>/keepalive` every ~30 s keeps telemetry flowing. Never publish
  `W/` control topics.

## Verification workflow (AGENTS.md checklist)

1. Backend tests: `PYTHONPATH=backend python -m pytest backend/tests/ -q` (unit tests
   run anywhere; integration tests need `TEST_DATABASE_URL` ending in `_test`).
   Container pattern that works: create `venus_test` DB in the compose Postgres,
   `docker cp backend/tests <container>:/app/tests`, install `pytest httpx` inside,
   run pytest in-container. Tests are id-agnostic — keep it that way (Postgres serials
   don't reset between runs).
2. Frontend: `npm run build --prefix frontend`.
3. Browser: log in, check desktop + mobile viewport (bottom nav, card wrap), dark and
   light themes, live data banner ("System connected"), settings as admin and as viewer.
4. Rebuild after edits: `docker compose up -d --build venus-backend venus-frontend`.

## Where things stand

Done and committed:

- Helio app: live MQTT telemetry (TLS 8883 + auth), energy flow, battery gauge,
  searchable devices, demo mode, mobile-responsive layout, dark/light/system theming.
- Multi-user auth: owner admin + viewer accounts, People management, self password
  change, admin reset (revokes sessions), CSRF + rate limiting + hashed-at-rest sessions.
- History: `energy_samples` summaries every 15 min by default (user-settable off/5/10/
  15/30/60), feeding 24h/7d charts via `/api/readings`.
- Generator: card, flow node, chart series, pulse row — will light up when a genset
  reports; today the GX publishes no generator topics (start/stop configured, no genset).
- Docs: README/SETUP/CLAUDE/OPEN_ISSUES/HANDOFF all current as of this writing.

Not done (check OPEN_ISSUES.md for detail):

- Grid power still has no live source on this install (AC-in disconnected, no meter);
  the MultiPlus AC-in fallback is implemented and fills the card once an input is live.
- Production (Dokploy) not redeployed with the MQTT env block; also needs network
  reachability to the GX from wherever Dokploy runs.
- Legacy cron still failing every 10 min — recommend deleting the crontab line.
- VLAN 21 handoff checklist steps 2–5 (routed-access verification, temp-profile
  cleanup, security follow-ups) — `tenda-recovery-vlan21` is still active and may be
  masking the real routed path.

Done since this handoff was written (2026-09-21):

- Generator run log: `generator_runs` table + run state machine in the collector;
  exact durations from the Timers counter, kWh/peak W once genset power appears.
- Electrical detail on the dashboard: AC out V/A/Hz, DC loads, PV volts, inverter
  state, AC-in fallback for the grid card.
- Generator flow node moved into the energy-source column with the solar/grid cards.

## Credentials policy

- GX MQTT username/password live in `.env` (git-ignored) and nowhere else. Never commit
  them, never put them in docs, logs or screenshots. `.env.example` documents the shape.
- Local dev app passwords (jan/household) are disposable — the DB is a Compose volume.
- The GX web login (`remoteconsole` + password from the operator) is separate from MQTT
  credentials and was never available to agents.

## Style

Chat responses follow the `caveman` skill (see global CLAUDE.md). Source, docs, commits
and UI copy stay normal English. `AGENTS.md` also asks for `rtk` command prefixes and
codebase-memory MCP for discovery.
