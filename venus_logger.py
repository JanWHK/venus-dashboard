#!/usr/bin/env python3
"""Venus OS → Excel logger. Run once via cron every 10 minutes.

Columns:
  MQTT (direct):     Timestamp, DYNESS-L Battery (%), DBH AC-In L1 (W) [MQTT], AC-Out L1 (W) [MQTT]
  Playwright (live): DBH AC-In L1 (W) [Screen], AC-Out L1 (W) [Screen]
"""
import json, time, datetime, os, struct, warnings
import paho.mqtt.client as mqtt
import openpyxl
from playwright.sync_api import sync_playwright

warnings.filterwarnings("ignore", category=DeprecationWarning)

VENUS_HOST = "192.168.178.103"
VENUS_PORT  = 80
PORTAL_ID   = "c0619ab43e45"
XLSX_PATH   = "/home/janj/victron/battery_log.xlsx"

HEADERS = [
    "Timestamp",
    "DYNESS-L Battery (%)",
    "DYNESS-L Battery (V)",
    "DYNESS-L Battery (A)",
    "DBH AC-In L1 (V)",
    "DBH AC-In L1 (A)",
    "DBH AC-In L1 (W)",
    "DBH AC-In L1 (Hz)",
    "DBH AC-Out L1 (V)",
    "DBH AC-Out L1 (A)",
    "DBH AC-Out L1 (W)",
    "DBH AC-Out L1 (Hz)",
    "DBH AC-In L1 (W) [Screen]",
    "DBH AC-Out L1 (W) [Screen]",
]

# ── MQTT (direct) ────────────────────────────────────────────────────────────

MQTT_TOPICS = {
    "DYNESS-L Battery (%)":  f"N/{PORTAL_ID}/battery/512/Soc",
    "DYNESS-L Battery (V)":  f"N/{PORTAL_ID}/battery/512/Dc/0/Voltage",
    "DYNESS-L Battery (A)":  f"N/{PORTAL_ID}/battery/512/Dc/0/Current",
    "DBH AC-In L1 (V)":      f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/V",
    "DBH AC-In L1 (A)":      f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/I",
    "DBH AC-In L1 (W)":      f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/P",
    "DBH AC-In L1 (Hz)":     f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/F",
    "DBH AC-Out L1 (V)":     f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/V",
    "DBH AC-Out L1 (A)":     f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/I",
    "DBH AC-Out L1 (W)":     f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/P",
    "DBH AC-Out L1 (Hz)":    f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/F",
}

mqtt_collected = {}

def on_connect(client, userdata, flags, rc):
    for topic in MQTT_TOPICS.values():
        client.subscribe(topic)
    client.publish(f"R/{PORTAL_ID}/keepalive")

def on_message(client, userdata, msg):
    try:
        value = json.loads(msg.payload).get("value")
    except Exception:
        return
    for label, topic in MQTT_TOPICS.items():
        if msg.topic == topic:
            mqtt_collected[label] = value

mqttc = mqtt.Client(transport="websockets")
mqttc.on_connect = on_connect
mqttc.on_message = on_message
mqttc.ws_set_options(path="/websocket-mqtt", headers={"Sec-WebSocket-Protocol": "mqtt"})
mqttc.connect(VENUS_HOST, VENUS_PORT, 60)
mqttc.loop_start()
time.sleep(5)
mqttc.loop_stop()

# ── Playwright (screen values via WebSocket interception) ─────────────────────

SCREEN_TOPICS = {
    f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/P": "DBH AC-In L1 (W) [Screen]",
    f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/P":      "DBH AC-Out L1 (W) [Screen]",
}
screen_collected = {}

def parse_all_publishes(data: bytes):
    results = []
    pos = 0
    while pos < len(data):
        if pos >= len(data): break
        packet_type = (data[pos] & 0xF0) >> 4
        i = pos + 1
        mult, rem_len = 1, 0
        while i < len(data):
            b = data[i]; rem_len += (b & 0x7F) * mult; mult *= 128; i += 1
            if (b & 0x80) == 0: break
        header_end = i
        packet_end = header_end + rem_len
        if packet_end > len(data): break
        if packet_type == 3:  # PUBLISH
            qos = (data[pos] & 0x06) >> 1
            p = header_end
            if p + 2 > packet_end: break
            tlen = struct.unpack('>H', data[p:p+2])[0]; p += 2
            if p + tlen > packet_end: break
            topic = data[p:p+tlen].decode('utf-8', errors='replace'); p += tlen
            if qos > 0: p += 2
            payload = data[p:packet_end].decode('utf-8', errors='replace')
            results.append((topic, payload))
        pos = packet_end
    return results

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    def handle_ws(ws):
        def on_frame(payload):
            if not isinstance(payload, bytes): return
            for topic, pl in parse_all_publishes(payload):
                if topic in SCREEN_TOPICS:
                    try:
                        v = json.loads(pl).get("value")
                        screen_collected[SCREEN_TOPICS[topic]] = v
                    except: pass
        ws.on("framereceived", lambda payload: on_frame(payload))

    page.on("websocket", handle_ws)
    page.goto(f"http://{VENUS_HOST}/gui-v2/", timeout=30000)
    page.wait_for_timeout(10000)  # keep event loop alive so WS frames are received
    browser.close()

# ── Write to Excel ────────────────────────────────────────────────────────────

def fmt(v):
    return round(v, 1) if isinstance(v, float) else v

timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
row = [
    timestamp,
    fmt(mqtt_collected.get("DYNESS-L Battery (%)")),
    fmt(mqtt_collected.get("DYNESS-L Battery (V)")),
    fmt(mqtt_collected.get("DYNESS-L Battery (A)")),
    fmt(mqtt_collected.get("DBH AC-In L1 (V)")),
    fmt(mqtt_collected.get("DBH AC-In L1 (A)")),
    fmt(mqtt_collected.get("DBH AC-In L1 (W)")),
    fmt(mqtt_collected.get("DBH AC-In L1 (Hz)")),
    fmt(mqtt_collected.get("DBH AC-Out L1 (V)")),
    fmt(mqtt_collected.get("DBH AC-Out L1 (A)")),
    fmt(mqtt_collected.get("DBH AC-Out L1 (W)")),
    fmt(mqtt_collected.get("DBH AC-Out L1 (Hz)")),
    fmt(screen_collected.get("DBH AC-In L1 (W) [Screen]")),
    fmt(screen_collected.get("DBH AC-Out L1 (W) [Screen]")),
]

if os.path.exists(XLSX_PATH):
    wb = openpyxl.load_workbook(XLSX_PATH)
    ws = wb.active
else:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEADERS)

ws.append(row)
wb.save(XLSX_PATH)
print(f"Logged: {row}")
