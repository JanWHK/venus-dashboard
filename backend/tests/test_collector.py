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


def test_electrical_detail_metrics_from_vebus_system_and_charger():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "vebus/275/Ac/Out/L1/V", 230.1)
    send(collector, "vebus/275/Ac/Out/L1/I", 5.71)
    send(collector, "vebus/275/Ac/Out/L1/S", 1313)
    send(collector, "vebus/275/Ac/Out/L1/F", 49.95)
    send(collector, "vebus/275/State", 9)
    send(collector, "system/0/Dc/System/Power", 159.3)
    send(collector, "system/0/Dc/System/Current", 2.98)
    send(collector, "solarcharger/275/Pv/V", 109.04)
    send(collector, "solarcharger/275/Dc/0/Current", 21.4)
    metrics = collector.snapshot()["metrics"]
    assert metrics["ac_out_voltage"] == 230.1
    assert metrics["ac_out_current"] == 5.71
    assert metrics["ac_out_apparent"] == 1313
    assert metrics["ac_out_frequency"] == 49.95
    assert metrics["inverter_state"] == 9
    assert metrics["dc_load_power"] == 159.3
    assert metrics["dc_load_current"] == 2.98
    assert metrics["pv_voltage"] == 109.04
    assert metrics["pv_current"] == 21.4


def test_grid_falls_back_to_vebus_active_input_only_when_connected():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 240)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 0)
    assert collector.snapshot()["metrics"]["grid_power"] is None
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 0)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 850)
    assert collector.snapshot()["metrics"]["grid_power"] == 850
    send(collector, "system/0/Ac/Grid/L1/Power", -120)
    assert collector.snapshot()["metrics"]["grid_power"] == -120


def test_ac_in_power_and_source_follow_active_input():
    collector = LiveCollector()
    collector.connected = True
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 240)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 0)
    metrics = collector.snapshot()["metrics"]
    assert metrics["ac_in_power"] is None
    assert metrics["ac_in_source"] is None
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 0)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 850)
    metrics = collector.snapshot()["metrics"]
    assert metrics["ac_in_power"] == 850
    assert metrics["ac_in_source"] == "grid"
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 1)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 2400)
    metrics = collector.snapshot()["metrics"]
    assert metrics["ac_in_power"] == 2400
    assert metrics["ac_in_source"] == "generator"


def test_live_genset_power_marks_input_as_generator_even_on_grid_slot():
    # This installation wires the genset to AC input 0 (the "grid" slot);
    # reported genset power, not the input slot, identifies the source.
    collector = LiveCollector()
    collector.connected = True
    send(collector, "vebus/1/Ac/ActiveIn/ActiveInput", 0)
    send(collector, "vebus/1/Ac/ActiveIn/L1/P", 3201)
    send(collector, "system/0/Ac/Genset/L1/Power", 3201)
    send(collector, "system/0/Ac/Consumption/L1/Power", 1405)
    metrics = collector.snapshot()["metrics"]
    assert metrics["ac_in_source"] == "generator"
    assert metrics["generator_power"] == 3201
    assert metrics["grid_power"] is None
    assert metrics["ac_in_power"] == 3201


def seed_at(collector, path, value, at):
    collector.values[f"system/0/{path}"] = {"value": value, "at": at}


def test_generator_run_duration_is_exact_from_timers_counter():
    collector = LiveCollector()
    collector.connected = True
    t0 = 1_000_000.0
    seed_at(collector, "Timers/TimeOnGenerator", 15434, t0)
    collector._track_generator(t0 + 1)
    assert collector.generator_run is None
    seed_at(collector, "Timers/TimeOnGenerator", 15500, t0 + 61)
    collector._track_generator(t0 + 61)
    assert collector.generator_run is not None
    # Start backdated by the observed counter jump.
    assert collector.generator_run["started_at"] == t0 + 61 - 66
    seed_at(collector, "Timers/TimeOnGenerator", 16000, t0 + 400)
    collector._track_generator(t0 + 400)
    collector._track_generator(t0 + 900)
    assert collector.generator_run is None
    run = collector.generator_runs[-1]
    assert run["duration_seconds"] == 16000 - 15434
    assert run["energy_wh"] == 0
    assert not run["power_seen"]


def test_generator_energy_integrates_genset_power():
    collector = LiveCollector()
    collector.connected = True
    t0 = 2_000_000.0
    seed_at(collector, "Timers/TimeOnGenerator", 100, t0)
    collector._track_generator(t0)
    seed_at(collector, "Timers/TimeOnGenerator", 110, t0 + 10)
    seed_at(collector, "Ac/Genset/L1/Power", 2000, t0 + 10)
    collector._track_generator(t0 + 10)
    collector._track_generator(t0 + 70)
    run = collector.generator_run
    assert abs(run["energy_wh"] - 2000 * 60 / 3600) < 0.01
    assert run["peak_w"] == 2000
    assert run["power_seen"]


def test_generator_state_signal_opens_and_closes_run():
    collector = LiveCollector()
    collector.connected = True
    t0 = 3_000_000.0
    collector.values["generator/0/State"] = {"value": 1, "at": t0}
    collector._track_generator(t0)
    assert collector.generator_run is not None
    assert collector.generator_run["started_at"] == t0
    collector.values["generator/0/State"] = {"value": 0, "at": t0 + 500}
    collector._track_generator(t0 + 500)
    collector._track_generator(t0 + 900)
    assert collector.generator_run is None
    drained = collector.drain_generator_runs()
    assert len(drained) == 1 and drained[0]["duration_seconds"] == 500
    assert collector.drain_generator_runs() == []
