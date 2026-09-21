"""Persistent, read-only Venus MQTT subscription with a bounded live cache."""
import json
import math
import os
import ssl
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

SERVICES = {"system", "battery", "vebus", "solarcharger", "grid", "genset",
            "inverter", "acload", "tank", "temperature", "charger", "dcgenset",
            "generator"}
STALE_SECONDS = 90


class LiveCollector:
    def __init__(self):
        self.host = os.getenv("VENUS_HOST", "192.168.21.10")
        self.transport = os.getenv("MQTT_TRANSPORT", "websockets")
        self.port = int(os.getenv("VENUS_PORT", "9001" if self.transport == "websockets" else "1883"))
        self.portal = os.getenv("PORTAL_ID", "c0619ab43e45")
        self.values = {}
        self.lock = threading.RLock()
        self.connected = False
        self.error = None
        self.client = None

    def start(self):
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport=self.transport)
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_connect_fail = self.on_connect_fail
        self.client.on_message = self.on_message
        self.client.reconnect_delay_set(min_delay=2, max_delay=30)
        if os.getenv("MQTT_USERNAME"):
            self.client.username_pw_set(os.environ["MQTT_USERNAME"], os.getenv("MQTT_PASSWORD"))
        if self.transport == "websockets":
            self.client.ws_set_options(path=os.getenv("MQTT_WS_PATH", "/"))
        if os.getenv("MQTT_TLS", "false").lower() == "true":
            if os.getenv("MQTT_TLS_INSECURE", "false").lower() == "true":
                # GX serves a self-signed certificate; skip verification but
                # keep traffic encrypted. Never enable outside a trusted LAN.
                self.client.tls_set(cert_reqs=ssl.CERT_NONE)
                self.client.tls_insecure_set(True)
            else:
                self.client.tls_set()
        self.client.connect_async(self.host, self.port, keepalive=60)
        self.client.loop_start()

    def stop(self):
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()

    def on_connect(self, client, userdata, flags, reason_code, properties):
        with self.lock:
            self.connected = reason_code == 0
            self.error = None if self.connected else "MQTT authentication was refused."
            self.values.clear()
        if self.connected:
            for service in SERVICES:
                client.subscribe(f"N/{self.portal}/{service}/#")
            self.keepalive()

    def on_connect_fail(self, client, userdata):
        with self.lock:
            self.connected = False
            self.error = "Cannot connect to GX MQTT. Check MQTT access, port and credentials."

    def on_disconnect(self, client, userdata, flags, reason_code, properties):
        with self.lock:
            self.connected = False
            self.error = "GX connection lost. Reconnecting automatically."

    def keepalive(self):
        if self.client and self.connected:
            # R/keepalive requests telemetry only. Never publish to W/ control topics.
            self.client.publish(f"R/{self.portal}/keepalive")

    def on_message(self, client, userdata, message):
        parts = message.topic.split("/")
        if len(parts) < 5 or parts[0] != "N" or parts[1] != self.portal or parts[2] not in SERVICES:
            return
        if len(message.payload) > 4096:
            return
        try:
            value = json.loads(message.payload)["value"]
            if isinstance(value, (dict, list)) or (isinstance(value, float) and not math.isfinite(value)):
                return
            if value is not None and not isinstance(value, (str, int, float, bool)):
                return
        except (ValueError, TypeError, KeyError):
            return
        key = "/".join(parts[2:])
        with self.lock:
            if key not in self.values and len(self.values) >= 6000:
                return
            self.values[key] = {"value": value, "at": time.time()}

    def snapshot(self, include_devices=False):
        now = time.time()
        with self.lock:
            values = {key: dict(item) for key, item in self.values.items()}
            connected, error = self.connected, self.error
        fresh = {k: v["value"] for k, v in values.items() if connected and now - v["at"] <= STALE_SECONDS}

        def number(value):
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

        def get(service, path):
            candidates = sorted((k, v) for k, v in fresh.items()
                                if k.startswith(service + "/") and k.split("/", 2)[2] == path)
            return next((number(v) for _, v in candidates if number(v) is not None), None)

        def fallback(*items):
            return next((item for item in items if item is not None), None)

        def phases(prefix):
            valid = [v for phase in (1, 2, 3) if (v := get("system", f"{prefix}/L{phase}/Power")) is not None]
            return sum(valid) if valid else None

        def solar_sum(path):
            valid = [number(v) for k, v in fresh.items() if k.startswith("solarcharger/")
                     and k.split("/", 2)[2] == path and number(v) is not None]
            return sum(valid) if valid else None

        voltage = fallback(get("system", "Dc/Battery/Voltage"), get("battery", "Dc/0/Voltage"))
        current = fallback(get("system", "Dc/Battery/Current"), get("battery", "Dc/0/Current"))
        solar_parts = [v for v in (fallback(get("system", "Dc/Pv/Power"), solar_sum("Yield/Power")),
                                  phases("Ac/PvOnOutput"), phases("Ac/PvOnGrid"), phases("Ac/PvOnGenset")) if v is not None]
        metrics = {
            "solar_power": sum(solar_parts) if solar_parts else None,
            "battery_soc": fallback(get("system", "Dc/Battery/Soc"), get("battery", "Soc")),
            "battery_voltage": voltage, "battery_current": current,
            "battery_power": fallback(get("system", "Dc/Battery/Power"), get("battery", "Dc/0/Power"),
                                      voltage * current if voltage is not None and current is not None else None),
            "battery_temperature": get("battery", "Dc/0/Temperature"),
            "grid_power": phases("Ac/Grid"), "load_power": phases("Ac/Consumption"),
            "solar_yield_today": solar_sum("History/Daily/0/Yield"),
            "grid_voltage": get("grid", "Ac/L1/Voltage"),
            "ac_out_voltage": get("vebus", "Ac/Out/L1/V"),
            "ac_out_frequency": get("vebus", "Ac/Out/L1/F"),
            "system_state": get("system", "SystemState/State"),
            "battery_time_to_go": get("system", "Dc/Battery/TimeToGo"),
            "generator_state": get("generator", "State"),
            "generator_power": phases("Ac/Genset"),
            "generator_runtime": get("system", "Timers/TimeOnGenerator"),
        }
        last = max((v["at"] for v in values.values()), default=None)
        result = {"status": "live" if connected and fresh else "waiting" if connected else "offline",
                  "host": self.host, "portal_id": self.portal,
                  "updated_at": datetime.fromtimestamp(last, timezone.utc).isoformat() if last else None,
                  "metrics": metrics, "topic_count": len(fresh), "error": error,
                  "device_count": len({"/".join(k.split("/")[:2]) for k in fresh}),
                  "alarms": [{"device": "/".join(k.split("/")[:2]), "name": k.split("/Alarms/", 1)[1], "value": v}
                             for k, v in fresh.items() if "/Alarms/" in k and isinstance(v, (int, float)) and v > 0]}
        if include_devices:
            devices = {}
            for key, item in sorted(values.items()):
                service, instance, path = key.split("/", 2)
                device = devices.setdefault(f"{service}/{instance}", {"id": f"{service}/{instance}", "service": service,
                    "name": service.replace("solarcharger", "Solar charger").title(), "instance": instance, "metrics": []})
                if path in ("CustomName", "ProductName") and item["value"]:
                    device["name"] = str(item["value"])
                device["metrics"].append({"path": path, "value": item["value"],
                    "stale": not connected or now - item["at"] > STALE_SECONDS})
            result["devices"] = list(devices.values())
        return result


collector = LiveCollector()
