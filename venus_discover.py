#!/usr/bin/env python3
"""One-time discovery: prints all Venus OS MQTT topics and values for 10 seconds."""
import json, time
import paho.mqtt.client as mqtt

VENUS_HOST = "192.168.178.103"
VENUS_PORT = 80

seen = {}

PORTAL_ID = "c0619ab43e45"

def on_connect(client, userdata, flags, rc):
    print(f"Connected (rc={rc}), subscribing to N/#")
    client.subscribe("N/#")
    # Venus OS requires keepalive publish to start sending data
    client.publish(f"R/{PORTAL_ID}/keepalive")

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload)
        value = payload.get("value")
    except Exception:
        value = msg.payload.decode(errors="replace")
    seen[msg.topic] = value

client = mqtt.Client(transport="websockets")
client.on_connect = on_connect
client.on_message = on_message
client.ws_set_options(path="/websocket-mqtt", headers={"Sec-WebSocket-Protocol": "mqtt"})
client.connect(VENUS_HOST, VENUS_PORT, 60)
client.loop_start()
print("Collecting topics for 10 seconds...")
time.sleep(10)
client.loop_stop()

print(f"\n=== Found {len(seen)} topics ===\n")
for topic in sorted(seen.keys()):
    val = seen[topic]
    # Highlight relevant topics
    t_lower = topic.lower()
    highlight = any(k in t_lower for k in ["battery", "ac/", "soc", "dyness", "dbh"])
    prefix = ">>> " if highlight else "    "
    print(f"{prefix}{topic} = {val}")
