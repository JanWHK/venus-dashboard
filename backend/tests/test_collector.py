import json
import time
from types import SimpleNamespace

from collector import LiveCollector, STALE_SECONDS


def send(collector, path, value):
    collector.on_message(None, None, SimpleNamespace(topic=f"N/{collector.portal}/{path}", payload=json.dumps({"value": value}).encode()))


def test_live_values_and_power_direction():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "system/0/Dc/Battery/Soc", 0)
    send(collector, "system/0/Dc/Battery/Power", -500)
    send(collector, "system/0/Ac/Grid/L1/Power", -120)
    send(collector, "system/0/Ac/Consumption/L1/Power", 1000)
    send(collector, "system/0/Ac/Consumption/L2/Power", 500)
    result = collector.snapshot()
    assert result["status"] == "live"
    assert result["metrics"]["battery_soc"] == 0
    assert result["metrics"]["battery_power"] == -500
    assert result["metrics"]["grid_power"] == -120
    assert result["metrics"]["load_power"] == 1500
    assert result["metrics"]["solar_power"] is None


def test_solar_aggregate_does_not_double_count_chargers():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "solarcharger/1/Yield/Power", 1000)
    send(collector, "solarcharger/2/Yield/Power", 500)
    assert collector.snapshot()["metrics"]["solar_power"] == 1500
    send(collector, "system/0/Dc/Pv/Power", 1500)
    send(collector, "system/0/Ac/PvOnOutput/L1/Power", 800)
    assert collector.snapshot()["metrics"]["solar_power"] == 2300


def test_missing_and_stale_metrics_are_never_zero_or_live():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "battery/512/Soc", 81)
    collector.values["battery/512/Soc"]["at"] = time.time() - STALE_SECONDS - 1
    snapshot = collector.snapshot(True)
    assert snapshot["status"] == "waiting"
    assert snapshot["metrics"]["battery_soc"] is None
    assert snapshot["devices"][0]["metrics"][0]["stale"]
    send(collector, "battery/512/Soc", 82)
    collector.on_disconnect(None, None, None, None, None)
    assert collector.snapshot()["metrics"]["battery_soc"] is None
    assert collector.snapshot()["status"] == "offline"


def test_reconnect_clears_previous_readings():
    collector = LiveCollector()
    send(collector, "battery/512/Soc", 81)
    fake = SimpleNamespace(subscribe=lambda topic: None)
    collector.on_connect(fake, None, None, 0, None)
    assert not collector.values


def test_malformed_private_and_oversized_payloads_are_ignored():
    collector = LiveCollector()
    for topic, payload in [("settings/0/Secret", b'{"value":"private"}'), ("battery/1/Soc", b'broken'),
                           ("battery/1/Soc", b'{"value":NaN}'), ("battery/1/Soc", b'[]'),
                           ("battery/1/Soc", b'{"value":{"nested":1}}'), ("battery/1/Soc", b'x' * 4097)]:
        collector.on_message(None, None, SimpleNamespace(topic=f"N/{collector.portal}/{topic}", payload=payload))
    collector.on_message(None, None, SimpleNamespace(topic="N/another-portal/battery/1/Soc", payload=b'{"value":80}'))
    assert collector.values == {}


def test_devices_and_alarms_are_discovered_without_fixed_instances():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "battery/999/ProductName", "New battery")
    send(collector, "battery/999/Alarms/LowVoltage", 2)
    send(collector, "temperature/35/Temperature", 23.4)
    snapshot = collector.snapshot(True)
    assert snapshot["device_count"] == 2
    assert snapshot["devices"][0]["name"] == "New battery"
    assert snapshot["alarms"] == [{"device": "battery/999", "name": "LowVoltage", "value": 2}]


def test_cache_is_bounded_but_existing_values_update():
    collector = LiveCollector()
    collector.values = {f"battery/1/{i}": {"value": i, "at": time.time()} for i in range(6000)}
    send(collector, "battery/1/new", 7)
    assert len(collector.values) == 6000
    send(collector, "battery/1/0", 9)
    assert collector.values["battery/1/0"]["value"] == 9


def test_generator_state_power_and_runtime():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "generator/0/State", 0)
    send(collector, "system/0/Timers/TimeOnGenerator", 15434)
    metrics = collector.snapshot()["metrics"]
    assert metrics["generator_state"] == 0
    assert metrics["generator_power"] is None
    assert metrics["generator_runtime"] == 15434
    send(collector, "generator/0/State", 1)
    send(collector, "system/0/Ac/Genset/L1/Power", 1200)
    send(collector, "system/0/Ac/Genset/L2/Power", 1300)
    metrics = collector.snapshot()["metrics"]
    assert metrics["generator_state"] == 1
    assert metrics["generator_power"] == 2500
