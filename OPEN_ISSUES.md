# Open Issues & Next Steps

## Known Issues

### Permission denied on battery_log.xlsx
- **Status:** Unresolved — context unknown (file manager? network share? Windows?)
- **File permissions:** `-rw-r--r--` owned by `janj` — readable by all local users
- **If accessing from Windows via Samba:** `/home/janj` is `drwx------` (700), which blocks
  traversal from network. Fix: `chmod 755 /home/janj` or move the file to a shared folder.
- **If file is open in Excel while cron writes:** Excel locks the file → cron write fails silently.
  Check `venus_logger.log` for errors.

### Screen columns show None for first ~5 rows in test runs
- **Cause:** Playwright WebSocket takes ~3-5s to connect and receive initial MQTT burst.
- **Impact:** Only affects manual test runs. Cron job (single row per run) always waits 10s
  before writing, so values are always populated.

## Potential Improvements

### Add more metrics
Available but not yet logged (from venus_discover.py):
- Solar: `N/c0619ab43e45/solarcharger/274/Dc/0/Power` — solar panel power (W)
- Solar: `N/c0619ab43e45/solarcharger/274/Yield/Power` — yield
- Battery power: `N/c0619ab43e45/battery/512/Dc/0/Power` — net battery power (W)
- Battery temp: `N/c0619ab43e45/battery/512/Dc/0/Temperature` — °C

### Adding a new column
1. Add topic to `MQTT_TOPICS` dict in `venus_logger.py`
2. Add header to `HEADERS` list
3. Add `fmt(mqtt_collected.get("..."))` to `row` list in same position
4. Update row 1 of existing Excel: run the header-update snippet in CLAUDE.md

### Auto-open Excel file
Currently the file must be manually opened. Could serve it via a simple HTTP server
or push to Google Sheets / OneDrive for live access.

### Grafana / dashboard
All MQTT data is available live — could wire directly into Grafana via MQTT datasource
pointing at `192.168.178.103/websocket-mqtt`.
