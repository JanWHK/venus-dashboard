# Open Issues & Next Steps

> Live status as of 2026-09-22. The Helio dashboard (Docker, `localhost:8081`) replaces
> the original Excel logger as the primary interface; historical notes at the bottom.

## Open items

### Local dev login `jan` / `helio-dev-2026` was rejected (2026-09-21)
- Login via the API returned "Username or password is incorrect" for the documented
  local test account, so the dev DB volume was likely recreated at some point (or the
  password changed). Production was unaffected.
- **Action:** re-create the account via the first-use setup key in the backend log, or
  reset the row in the local DB, then update `CLAUDE.md`.

### Browser-based UI verification was limited on 2026-09-21/22
- The T3 preview automation host was down all session; the recent UI work (generator
  input split panel, sun/moon icons, V·Hz captions) was verified by `npm run build`,
  demo-mode arithmetic and code review, not by screenshots. Playwright suite not run.
- **Action:** next agent with a working browser: sanity-check the Generator input
  panel (4 tiles + 3-segment bar) and moon icons in both themes.

### Grid power has no live source on this installation
- **Cause:** the GX publishes no `grid` service and no grid meter is installed; the
  MultiPlus AC-in is only ever live while the genset runs — and **the genset is wired
  to AC input 0**, the slot configured as "grid".
- **Status:** the fallback is implemented (2026-09-21) — `grid_power` maps
  `vebus/*/Ac/ActiveIn/L1/P` when an input is active (`ActiveInput` 0/1), but since
  2026-09-21 (commit `ebff508`) live genset power wins the identity check: while genset
  power > 20 W the input is labeled generator and `grid_power` stays null. A dedicated
  grid meter would still give cleaner per-phase data if a real grid feed is added.

### Generator energy — resolved 2026-09-21
- The genset ran for real on 2026-09-21 and `system/0/Ac/Genset/L1/Power` reports
  while it runs (it stays null when idle; there is still no `generator/0/State`).
- Run tracking works end to end: exact durations from the Timers counter, and kWh /
  peak W now integrate from the live genset power. The generator source-detection bug
  (genset labeled "grid" because it sits on input 0) was fixed in `ebff508`.
- The UI shows a Generator input panel while it feeds (see `CLAUDE.md`); known wobble:
  `Dc/System/Power` and genset output are not instantaneous, so the split tiles move
  between samples by a few hundred watts.

### Legacy logger cron fails every 10 minutes
- `crontab` still runs `/usr/bin/python3 /home/janj/victron/venus_logger.py`, which
  lacks `paho`/`openpyxl` → `ModuleNotFoundError` in `venus_logger.log` every tick.
- `battery_log.xlsx` stale since 2026-03-28. Helio replaces the logger.
- **Action:** delete the crontab entry (recommended) or revive the logger per SETUP.md.

### Production deploy lacks MQTT settings
- **Resolved 2026-09-21:** production runs on `labwhk` (LAN `192.168.100.104`) as compose
  project `venus` under `/opt/labwhk/apps/venus`, fronted by Dokploy's Traefik. The
  earlier "Dokploy host 100.111.222.14 unreachable" trail was a stale address. Deployed
  `main` (4f3dfb4) with the corrected GX/MQTT env block; all verification green, MQTT
  connected to the GX. Deploy via `.claude/skills/deploying-to-production` — the Dokploy
  UI/API is not involved.
- Historical requirements that still apply: the MQTT block must stay in the server's
  `.env` (GX broker rejects anonymous connections) and the host needs its route to
  `192.168.21.10:8883` (currently working).

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
- Generator run log (2026-09-21): see "Generator energy — resolved" above.
- Generator input split (2026-09-22): live panel + flow captions while the genset
  feeds (commits `1f52fad`, `ebff508`, `8ba193d`, `4016584`, `41edeec`).
- Sun/moon idle icons (2026-09-22): the solar card and flow node switch to a crescent
  when `solar_power` is 0/null (`ea53f92`, `3db65be`).
