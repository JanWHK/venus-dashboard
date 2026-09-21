// Deliberately separate from live telemetry. Demo values never reach the API or database.
export function demoSnapshot() {
  const now = Date.now();
  const history = Array.from({ length: 90 }, (_, i) => ({
    recorded_at: new Date(now - (89 - i) * 10000).toISOString(),
    solar_power: 3100 + Math.sin(i / 8) * 510 + Math.cos(i / 3) * 140,
    load_power: 1730 + Math.sin(i / 7 + 2) * 280 + Math.cos(i / 4) * 90,
    battery_power: 1220 + Math.sin(i / 9) * 250,
    grid_power: 0,
    generator_power: i > 60 ? 2400 + Math.sin(i / 2) * 180 : null,
    battery_soc: 78 + i / 30,
  }));
  const devices = [
    {
      id: "system/0",
      name: "Venus GX",
      service: "system",
      instance: "0",
      metrics: [
        { path: "Dc/Battery/Soc", value: 81 },
        { path: "Ac/Consumption/L1/Power", value: 1840 },
        { path: "Dc/Pv/Power", value: 3260 },
      ],
    },
    {
      id: "battery/512",
      name: "Dyness battery",
      service: "battery",
      instance: "512",
      metrics: [
        { path: "Soc", value: 81 },
        { path: "Dc/0/Voltage", value: 53.2 },
        { path: "Dc/0/Current", value: 26.7 },
        { path: "Dc/0/Temperature", value: 25.6 },
      ],
    },
    {
      id: "solarcharger/274",
      name: "SmartSolar MPPT 250/70",
      service: "solarcharger",
      instance: "274",
      metrics: [
        { path: "Pv/V", value: 184.2 },
        { path: "Yield/Power", value: 3260 },
        { path: "History/Daily/0/Yield", value: 18.4 },
      ],
    },
    {
      id: "vebus/275",
      name: "MultiPlus inverter",
      service: "vebus",
      instance: "275",
      metrics: [
        { path: "Ac/Out/L1/V", value: 230.1 },
        { path: "Ac/Out/L1/F", value: 50.0 },
        { path: "Ac/Out/L1/P", value: 1840 },
      ],
    },
  ];
  return {
    status: "live",
    host: "Demo installation",
    updated_at: new Date().toISOString(),
    portal_id: "demo",
    topic_count: devices.reduce((n, d) => n + d.metrics.length, 0),
    device_count: devices.length,
    alarms: [],
    devices,
    history,
    recording_interval: 0,
    metrics: {
      solar_power: 3260,
      load_power: 1840,
      grid_power: 0,
      battery_power: 1420,
      battery_soc: 81,
      battery_voltage: 53.2,
      battery_current: 26.7,
      battery_temperature: 25.6,
      solar_yield_today: 18.4,
      ac_out_voltage: 230.1,
      ac_out_current: 8,
      ac_out_apparent: 1840,
      ac_out_frequency: 50,
      ac_in_voltage: 231.2,
      ac_in_current: 4.1,
      ac_in_frequency: 50,
      dc_load_power: 64,
      dc_load_current: 1.2,
      pv_voltage: 96.4,
      pv_current: 34.1,
      inverter_state: 9,
      system_state: 3,
      generator_state: 1,
      generator_power: 2560,
      generator_runtime: 15434,
    },
    generator_runs: (() => {
      const now = Date.now();
      return {
        active_run: null,
        recent: [
          {
            started_at: new Date(now - 26 * 3600_000).toISOString(),
            ended_at: new Date(now - 26 * 3600_000 + 92 * 60_000).toISOString(),
            duration_seconds: 92 * 60,
            energy_kwh: 24.8,
            peak_power_w: 2950,
          },
          {
            started_at: new Date(now - 50 * 3600_000).toISOString(),
            ended_at: new Date(now - 50 * 3600_000 + 47 * 60_000).toISOString(),
            duration_seconds: 47 * 60,
            energy_kwh: 12.1,
            peak_power_w: 2780,
          },
        ],
      };
    })(),
  };
}
