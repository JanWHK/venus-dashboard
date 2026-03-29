import json
import os
import time

import paho.mqtt.client as mqtt

VENUS_HOST = os.environ.get("VENUS_HOST", "192.168.178.103")
VENUS_PORT = int(os.environ.get("VENUS_PORT", 80))
PORTAL_ID = os.environ.get("PORTAL_ID", "c0619ab43e45")

MQTT_TOPICS = {
    "battery_soc":      f"N/{PORTAL_ID}/battery/512/Soc",
    "battery_voltage":  f"N/{PORTAL_ID}/battery/512/Dc/0/Voltage",
    "battery_current":  f"N/{PORTAL_ID}/battery/512/Dc/0/Current",
    "ac_in_voltage":    f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/V",
    "ac_in_current":    f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/I",
    "ac_in_power":      f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/P",
    "ac_in_frequency":  f"N/{PORTAL_ID}/vebus/275/Ac/ActiveIn/L1/F",
    "ac_out_voltage":   f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/V",
    "ac_out_current":   f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/I",
    "ac_out_power":     f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/P",
    "ac_out_frequency": f"N/{PORTAL_ID}/vebus/275/Ac/Out/L1/F",
    "solar_pv_voltage":   f"N/{PORTAL_ID}/solarcharger/274/Pv/V",
    "solar_pv_current":   f"N/{PORTAL_ID}/solarcharger/274/Pv/I",
    "solar_pv_power":     f"N/{PORTAL_ID}/solarcharger/274/Yield/Power",
    "solar_batt_voltage": f"N/{PORTAL_ID}/solarcharger/274/Dc/0/Voltage",
    "solar_batt_current": f"N/{PORTAL_ID}/solarcharger/274/Dc/0/Current",
    "solar_yield_total":  f"N/{PORTAL_ID}/solarcharger/274/History/Overall/UserYield",
    "solar_yield_system": f"N/{PORTAL_ID}/solarcharger/274/History/Overall/SystemYield",
}


def collect_reading(wait_seconds: float = 3.0) -> dict:
    """Connect to MQTT, collect all topics, return dict of field→value."""
    collected: dict = {}

    def on_connect(client, userdata, flags, rc):
        for topic in MQTT_TOPICS.values():
            client.subscribe(topic)
        client.publish(f"R/{PORTAL_ID}/keepalive")

    def on_message(client, userdata, msg):
        try:
            value = json.loads(msg.payload).get("value")
        except Exception:
            return
        for field, topic in MQTT_TOPICS.items():
            if msg.topic == topic:
                collected[field] = value

    client = mqtt.Client(transport="websockets")
    client.on_connect = on_connect
    client.on_message = on_message
    client.ws_set_options(path="/websocket-mqtt", headers={"Sec-WebSocket-Protocol": "mqtt"})

    try:
        client.connect(VENUS_HOST, VENUS_PORT, 60)
        client.loop_start()
        time.sleep(wait_seconds)
        client.loop_stop()
        client.disconnect()
    except Exception as e:
        print(f"MQTT collection error: {e}")

    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in collected.items()}
