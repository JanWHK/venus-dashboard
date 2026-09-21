# Setup Guide

> Two generations live in this repo: the current **Helio dashboard** (Docker, below) and
> the legacy Excel logger (bottom). The logger is superseded — Helio replaces it.

## Helio dashboard setup

### 1. Configure the environment

```bash
cp .env.example .env
```

Fill in the MQTT block. Current GX reality (firmware at `192.168.21.10`):

```
VENUS_HOST=192.168.21.10
VENUS_PORT=8883          # TLS MQTT; 1883/9001 are refused or redirected
MQTT_TRANSPORT=tcp
MQTT_TLS=true
MQTT_TLS_INSECURE=true   # GX serves a self-signed certificate (LAN only)
MQTT_USERNAME=<GX MQTT user>     # GX → Settings → Services → MQTT
MQTT_PASSWORD=<GX MQTT password>
```

`.env` is git-ignored and also pins `COMPOSE_PROJECT_NAME=victron-helio` — do not remove
that line or Compose will create a duplicate stack.

### 2. Start

```bash
rtk docker compose -p victron-helio up -d --build
```

Dashboard: http://localhost:8081 (loopback only).

### 3. First login

Copy the **Helio first-use setup key** from the backend startup log
(`docker compose logs venus-backend | grep "setup key"`) into the onboarding form and
create the owner account (password ≥ 12 characters). The key works only until the first
account exists. That account is admin; invite viewers under **Settings → People**.

### 4. Verify live data

- Dashboard header shows **System connected · 192.168.21.10**.
- Settings → GX gateway shows the configured host/port/transport.
- If it says "Cannot connect to GX MQTT": check reachability (`ping`), broker auth
  (`MQTT_USERNAME`/`MQTT_PASSWORD`), and TLS settings.
- Recording defaults to a 15-minute summary; adjust in Settings. The 24h/7d charts
  fill as samples accumulate in `energy_samples`.

### Production (Dokploy)

Set the same MQTT variables plus `DATABASE_URL`/`SYNC_DATABASE_URL` in the Dokploy UI
(remember `%40` encoding for `@` in the DB password). Cookies switch to Secure
automatically via `COOKIE_SECURE=true`. The backend must be able to reach the GX
network from wherever Dokploy runs the stack.

---

## Legacy Excel logger (superseded)

The original `venus_logger.py` wrote battery/AC readings to `battery_log.xlsx` via cron.
Status: **broken and unused** — the GX moved to VLAN 21, the cron's `/usr/bin/python3`
lacks `paho`/`openpyxl`, and `battery_log.xlsx` has been stale since 2026-03-28.
Either remove the crontab line or, if the Excel export is still wanted, install the
dependencies for `/usr/bin/python3` and update the GX address to `192.168.21.10`:

```bash
# Legacy prerequisites (only if reviving the logger)
/usr/bin/python3 -m pip install paho-mqtt openpyxl playwright
/usr/bin/python3 -m playwright install chromium

# Legacy cron (currently failing every tick)
*/10 * * * * /usr/bin/python3 /home/janj/victron/venus_logger.py >> /home/janj/victron/venus_logger.log 2>&1
```

`venus_discover.py` remains useful as a one-shot MQTT topic dumper (update its host to
the current GX and supply MQTT credentials).
