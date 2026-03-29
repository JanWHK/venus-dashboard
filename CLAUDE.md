# Victron Venus OS Logger & Dashboard

## Web Dashboard
- **Local:** http://localhost:8081 (`docker compose up -d` with `docker-compose.yml`)
- **Production:** https://victron.afrinam.com (Dokploy, `docker-compose.prod.yml`)
- **GitHub:** `JanWHK/venus-dashboard`
- **Stack:** FastAPI + APScheduler + SQLAlchemy/asyncpg + React 18 + Recharts + PostgreSQL 15
- **Dokploy admin:** http://100.111.222.14:8000 (Tailscale)

### Production env vars (set in Dokploy UI)
`DATABASE_URL` and `SYNC_DATABASE_URL` use `%40` for `@` in the password (URL encoding required).
If Postgres auth fails after redeployment, exec into `venus-db` and run:
`psql -U venus -d venus -c "ALTER ROLE venus WITH PASSWORD 'newpassword';"`
(The `venus-db-data` named volume keeps the password from first init — changing the env var alone doesn't update it.)

## Device
- **URL:** http://192.168.178.103/gui-v1 (noVNC console) / http://192.168.178.103/gui-v2 (Qt WebAssembly UI)
- **Type:** Victron Venus OS GX device (NanoPi)
- **Portal ID:** `c0619ab43e45`
- **MQTT WebSocket:** `ws://192.168.178.103/websocket-mqtt` (requires header `Sec-WebSocket-Protocol: mqtt`)
- **Keepalive:** publish to `R/c0619ab43e45/keepalive` after connect to trigger data

## Why not Playwright DOM scraping
- `/gui-v1` = noVNC (VNC remote desktop in canvas) — no DOM elements
- `/gui-v2` = Qt WebAssembly app (canvas-based) — no DOM elements
- Solution: MQTT directly via paho-mqtt, plus Playwright WebSocket interception for screen values

## Files
- `venus_logger.py` — main logger, run once per cron tick
- `venus_discover.py` — one-time discovery script, prints all MQTT topics
- `battery_log.xlsx` — output spreadsheet
- `venus_logger.log` — cron output log

## Cron Job
```
*/10 * * * * /usr/bin/python3 /home/janj/victron/venus_logger.py >> /home/janj/victron/venus_logger.log 2>&1
```

## Python Dependencies
```
pip3 install paho-mqtt openpyxl playwright
playwright install chromium
```

## MQTT Device Instances
| Device | Instance | Description |
|---|---|---|
| DYNESS-L Battery | `512` | CAN BMS battery |
| DBH (MultiPlus-II 48/5000/70-50) | `275` | Inverter/charger (vebus) |
| SmartSolar MPPT 250/70 rev3 | `274` | Solar charger |

## MQTT Topics Used
| Label | Topic |
|---|---|
| DYNESS-L Battery (%) | `N/c0619ab43e45/battery/512/Soc` |
| DYNESS-L Battery (V) | `N/c0619ab43e45/battery/512/Dc/0/Voltage` |
| DYNESS-L Battery (A) | `N/c0619ab43e45/battery/512/Dc/0/Current` |
| DBH AC-In L1 (V) | `N/c0619ab43e45/vebus/275/Ac/ActiveIn/L1/V` |
| DBH AC-In L1 (A) | `N/c0619ab43e45/vebus/275/Ac/ActiveIn/L1/I` |
| DBH AC-In L1 (W) | `N/c0619ab43e45/vebus/275/Ac/ActiveIn/L1/P` |
| DBH AC-In L1 (Hz) | `N/c0619ab43e45/vebus/275/Ac/ActiveIn/L1/F` |
| DBH AC-Out L1 (V) | `N/c0619ab43e45/vebus/275/Ac/Out/L1/V` |
| DBH AC-Out L1 (A) | `N/c0619ab43e45/vebus/275/Ac/Out/L1/I` |
| DBH AC-Out L1 (W) | `N/c0619ab43e45/vebus/275/Ac/Out/L1/P` |
| DBH AC-Out L1 (Hz) | `N/c0619ab43e45/vebus/275/Ac/Out/L1/F` |

## Excel Columns (battery_log.xlsx)
1. Timestamp
2. DYNESS-L Battery (%)
3. DYNESS-L Battery (V)
4. DYNESS-L Battery (A)
5. DBH AC-In L1 (V)
6. DBH AC-In L1 (A)
7. DBH AC-In L1 (W)
8. DBH AC-In L1 (Hz)
9. DBH AC-Out L1 (V)
10. DBH AC-Out L1 (A)
11. DBH AC-Out L1 (W)
12. DBH AC-Out L1 (Hz)
13. DBH AC-In L1 (W) [Screen] — via Playwright WebSocket interception
14. DBH AC-Out L1 (W) [Screen] — via Playwright WebSocket interception

## Playwright WebSocket Interception
The gui-v2 app connects to the same MQTT broker. Playwright intercepts binary WebSocket frames and parses MQTT PUBLISH packets to extract screen values. The `framereceived` handler must use `page.wait_for_timeout()` (not `time.sleep()`) to keep the Playwright event loop alive.

## Typical Values (observed)
- Battery: ~40-46%, ~52-53V, ~18-21A (charging from grid)
- AC-In: ~212-217V, ~14-15A, ~2850-2980W, ~47-48Hz
- AC-Out: ~212-217V, ~7-8A, ~1600-1700W, ~46-49Hz
