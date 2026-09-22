# Agent Handoff — Helio / Victron Dashboard

> Written 2026-09-21 for the next agent. Read this plus `AGENTS.md` (workflow rules),
> `CLAUDE.md` (device/config facts), `OPEN_ISSUES.md` (live issue list) and
> `NETWORK_HANDOFF.md` (VLAN 21 work — still has an open checklist).

## What this project is

A private dashboard ("Helio") for a Victron Venus GX. FastAPI backend subscribes to the
GX's MQTT broker (read-only) and serves a React dashboard. Replaced an older Excel
logger (`venus_logger.py`, `battery_log.xlsx` — legacy, broken, see OPEN_ISSUES.md).

**Current state: working locally and in production.** Live GX telemetry, 15-minute
history recording, multi-user accounts (admin + viewers), a live generator: the genset
wired to MultiPlus AC input 0, reporting power while it runs, with Generator input and
Solar input split panels and a persisted run log, light/dark theming. The earlier
dashboard work is merged
to `main`. Battery alerts are documented in `ALERTS.md`; release procedure and
verification are in `DEPLOYMENT.md`.

## Running it

```bash
docker compose up -d --build        # project name victron-helio comes from .env
docker compose logs -f venus-backend
```

- Dashboard: http://localhost:8081 (loopback only).
- Use an existing private account or the first-use setup flow. Do not put passwords in handoffs.
- Production: https://victron.afrinam.com, Compose project `venus` on `labwhk`.
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
  `battery/512`. **No `grid` and no `generator` service** — but the genset itself
  reports `system/0/Ac/Genset/*` power while running (see the 2026-09-22 addendum).
  The UI deliberately shows dashes/"Not reported" for anything truly absent instead of
  fabricating values (see OPEN_ISSUES.md).
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

Battery alerts added after this handoff: see **[ALERTS.md](ALERTS.md)** for policy,
private credential setup, tests, and remaining operator checklist. Thresholds are
50%, 25%, and 15%; app sound is opt-in, Telegram is primary, email is fallback.
Real message delivery still requires configured credentials and recipient testing.

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
- Telegram and email require private credentials and actual recipient verification.
  Production MQTT connectivity was verified on 2026-09-21; deploy via `DEPLOYMENT.md`,
  not the Dokploy UI.
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

## Addendum — 2026-09-22 (generator went live; read this after the sections above)

The genset ran for real on 2026-09-21, which invalidated several "no genset yet"
assumptions in the older sections and produced six deployed commits:

- `ebff508` — **source-detection fix:** the genset is wired to AC input **0** (the slot
  configured as "grid"), so slot number ≠ source identity. The collector now marks the
  input as generator whenever `system/0/Ac/Genset/*` power exceeds
  `GENSET_MIN_WATTS = 20` (`backend/collector.py`), and `grid_power` stays null while
  it feeds. Unit test `test_live_genset_power_marks_input_as_generator_even_on_grid_slot`.
- `8ba193d` — **Generator input panel, DC line:** Total in = AC loads + DC loads (GX
  `Dc/System/Power`) + battery charging; charging is the computed remainder so the
  identity is exact. Third bar segment is amber `#b5803a` light / `#b9853f` dark,
  validated with the dataviz palette script in both modes.
- `4016584` / `41edeec` — genset **V · Hz** (`Ac/ActiveIn/L1/V` + `/F`) on the panel
  heading and on the flow diagram's generator node caption while it feeds.
- `ea53f92` / `3db65be` — solar card and flow solar node switch **sun → moon** when
  `solar_power` is 0/null.
- `039efca` — the split bar gained a **percentage row**: a centered label under each
  segment in muted ink, sharing its exact width. Shares always read a clean 100 %
  (AC + DC rounded, charging carries the remainder, clamped ≥ 0); labels follow
  segments, so DC's hides while the GX gives no `Dc/System` reading.
- `a38419f` — **Solar input panel**: the same four-tile/segment-bar/percentage panel
  for the array, shown while `solar_power > 0` (hidden at night, matching the sun/moon
  icon rule). Heading line is PV V · A instead of AC V · Hz. Reuses the generator
  panel's validated segment colors because both split into the same three
  destinations. Caveat: during a solar + genset overlap, each panel's charging
  remainder includes both charge sources (they are displays, not metering).
- `1f52fad` (earlier the same day) — the Generator input panel itself.

All six were deployed to production via the deploy skill with all 7 checks green, and
each verified by asset-hash comparison on the host (`Dashboard-*.js` grep).

Physics notes for the next agent (verified against live GX data):
`Ac/Consumption/L1/Power` ≡ vebus `Ac/Out/L1/P` exactly; `Dc/System/Power` is a noisy
GX aggregate (swings a few hundred W — the DC tile will wobble); genset output itself
swings ~500 W between 15 s samples; AC-in ≈ AC loads + battery net + DC + 4–6 %
inverter losses. The panel identity holds by construction because charging is the
remainder.

Verification gaps to close (also in OPEN_ISSUES.md):

- **UI screenshots**: the T3 preview automation host was down all session; the panel
  and icons were verified by build + demo arithmetic + code review only. Run the
  Playwright suite and eyeball both themes when a browser is available.
- **Local dev login** `jan` / `helio-dev-2026` was rejected (dev DB likely recreated);
  re-create via the setup key if you need the local stack interactively.

## Credentials policy

- GX MQTT username/password live in `.env` (git-ignored) and nowhere else. Never commit
  them, never put them in docs, logs or screenshots. `.env.example` documents the shape.
- Keep even disposable development account passwords out of new documentation.
- The GX web login (`remoteconsole` + password from the operator) is separate from MQTT
  credentials and was never available to agents.

## Style

Chat responses follow the `caveman` skill (see global CLAUDE.md). Source, docs, commits
and UI copy stay normal English. `AGENTS.md` also asks for `rtk` command prefixes and
codebase-memory MCP for discovery.
