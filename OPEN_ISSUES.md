# Open Issues & Next Steps

> Live status as of 2026-09-21. The Helio dashboard (Docker, `localhost:8081`) replaces
> the original Excel logger as the primary interface; historical notes at the bottom.

## Open items

### Grid power has no live source on this installation
- **Cause:** the GX publishes no `grid` service and no grid meter is installed; the
  MultiPlus AC-in is currently disconnected (`Ac/ActiveIn/ActiveInput = 240`).
- **Status:** the fallback is implemented (2026-09-21) — `grid_power` now maps
  `vebus/*/Ac/ActiveIn/L1/P` whenever an input is active (`ActiveInput` 0/1), so the
  card and chart series will fill the moment grid power actually flows. A dedicated
  grid meter would still give cleaner per-phase data.

### Generator energy needs a genset power source
- **Cause:** generator start/stop is configured on the GX (4.3 h lifetime runtime in
  `system/0/Timers/TimeOnGenerator`) but no genset device reports
  `generator/0/State` or `Ac/Genset/*` power. All `Ac/Genset/*` topics exist but are null.
- **Status:** run **tracking** is implemented (2026-09-21): the backend opens a
  `generator_runs` session whenever the Timers counter advances, so every run is
  persisted with its exact duration even without a genset device. **Energy** (kWh and
  peak W) stays null until `Ac/Genset/*` power or a genset service starts reporting —
  it will then be integrated automatically with no further changes.
- **Impact:** none — the UI shows the last run's duration and, once available, its
  energy alongside the lifetime runtime.

### Legacy logger cron fails every 10 minutes
- `crontab` still runs `/usr/bin/python3 /home/janj/victron/venus_logger.py`, which
  lacks `paho`/`openpyxl` → `ModuleNotFoundError` in `venus_logger.log` every tick.
- `battery_log.xlsx` stale since 2026-03-28. Helio replaces the logger.
- **Action:** delete the crontab entry (recommended) or revive the logger per SETUP.md.

### Production deploy lacks MQTT settings
- **Update 2026-09-21:** production (https://victron.afrinam.com) returns **502** and the
  Dokploy host (`100.111.222.14:8000`) is unreachable — not present on the tailnet and
  100% packet loss. The host must come back (or be rebuilt) before any deploy; the
  merged `main` (32a67cc) will build cleanly once it is.
- Dokploy needs `VENUS_PORT=8883`, `MQTT_TLS=true`, `MQTT_TLS_INSECURE=true`,
  `MQTT_USERNAME`, `MQTT_PASSWORD` (same values as local `.env`), and network reachability
  from the Dokploy host to `192.168.21.10` — which is only routable from VLAN 21/LAN.
  Running the production stack off-site will not reach the GX.

### VLAN 21 routed access & cleanup (from NETWORK_HANDOFF.md)
- `tenda-recovery-vlan21` temporary NetworkManager interface is **still active** on this
  workstation; the GX is reachable through it (and now through whatever path the user
  fixed — confirm before removing it).
- Remaining handoff checklist: verify routed access via pfSense LAN, verify the `.125`
  client, delete both `tenda-recovery-*` profiles and the temporary `192.168.2.10/24`
  address, then the security follow-ups (Tenda admin password, WPA2/AES).
- See the "Next-agent completion checklist" in `NETWORK_HANDOFF.md`.

### No password recovery flow
- By design. An operator with database access must reset accounts.

## Resolved / historical

### Helio MQTT connection (resolved 2026-09-21)
- Was: port 80 `/websocket-mqtt` returns 302 on this firmware; anonymous rejected.
- Fix: MQTT over TLS on 8883 with credentials; `MQTT_TLS_INSECURE=true` for the
  self-signed certificate; compose now forwards `MQTT_TLS_INSECURE`.

### Screen columns show None for first ~5 rows in test runs (historical, logger)
- Playwright WebSocket needed ~3-5s to connect before values appeared. Cron-based runs
  always waited 10s. Superseded with the logger.

### Permission denied on battery_log.xlsx (historical, unresolved context)
- `/home/janj` is `drwx------` (700), blocking Samba traversal; Excel holding the file
  open also locked cron writes. Moot while the logger is unused.

### Potential extra metrics (implemented in Helio)
- Solar power, battery power/temperature and generator runtime are all live now.
- `solar_yield_today` (`solarcharger/*/History/Daily/0/Yield`) feeds the "harvested
  today" line.
- Electrical detail (2026-09-21): AC out V/A/VA/Hz, AC-in V/A/Hz, DC loads, PV volts,
  and inverter state are surfaced on the dashboard (flow captions, metric chips,
  System pulse rows). Grid remains the only gap (see above).
- Generator run log (2026-09-21): see "Generator energy needs a genset power source".
