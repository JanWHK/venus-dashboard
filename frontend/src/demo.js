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
      ac_in_power: 2560,
      ac_in_source: "generator",
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

// Demo counterpart of GET /api/reports/{kind}. Data-only, clearly illustrative.
export function demoReport(kind) {
  const now = new Date();
  const day = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return d;
  };
  const head = {
    from: new Date(day(29).setHours(0, 0, 0, 0)).toISOString(),
    to: now.toISOString(),
    generated_at: now.toISOString(),
    samples: { used: 2740, complete: true, median_interval_seconds: 900 },
  };
  const daily = Array.from({ length: 30 }, (_, i) => ({
    date: day(29 - i).toLocaleDateString("en-CA"),
    energy_kwh:
      kind === "generator"
        ? i % 3 === 0
          ? null
          : Math.round((14 + Math.sin(i / 2.4) * 6) * 100) / 100
        : Math.round((16 + Math.sin(i / 3) * 7 + i / 9) * 100) / 100,
    ...(kind === "generator"
      ? {
          duration_seconds: i % 3 === 0 ? 0 : Math.round(5200 + Math.sin(i / 2) * 1600),
          runs: i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2,
        }
      : {}),
  }));
  if (kind === "generator") {
    return {
      ...head,
      kind,
      runs: {
        count: 14,
        total_duration_seconds: 51234,
        avg_duration_seconds: 3659.6,
        max_duration_seconds: 9100,
        peak_power_w: 3120,
        energy_kwh: 118.412,
        energy_known_runs: 11,
      },
      run_list: [
        {
          started_at: new Date(day(1).setHours(18, 4)).toISOString(),
          ended_at: new Date(day(1).setHours(20, 35)).toISOString(),
          duration_seconds: 9100,
          energy_kwh: 12.84,
          peak_power_w: 3010,
        },
        {
          started_at: new Date(day(3).setHours(7, 12)).toISOString(),
          ended_at: new Date(day(3).setHours(8, 41)).toISOString(),
          duration_seconds: 5340,
          energy_kwh: 7.41,
          peak_power_w: 2950,
        },
        {
          started_at: new Date(day(6).setHours(19, 48)).toISOString(),
          ended_at: new Date(day(6).setHours(20, 57)).toISOString(),
          duration_seconds: 4140,
          energy_kwh: null,
          peak_power_w: null,
        },
      ],
      energy: {
        window: "runs",
        genset_kwh: 121.31,
        ac_loads_kwh: 41.24,
        dc_loads_kwh: 2.06,
        charging_kwh: 78.01,
        battery_charged_kwh: 76.94,
        total_in_samples: 214,
        ac_loads_samples: 210,
        dc_loads_samples: 96,
      },
      monthly: [{
        month: now.toLocaleDateString("en-CA").slice(0, 7),
        runs: 14,
        metered_runs: 11,
        duration_seconds: 51234,
        energy_kwh: 118.412,
      }],
      fuel_calibration: {
        measured_liters: 11,
        metered_kwh: 17.1056,
        liters_per_kwh: 0.643064,
        run_starts: [],
      },
      daily,
    };
  }
  if (kind === "solar") {
    return {
      ...head,
      kind,
      energy: {
        window: "range",
        generated_kwh: 512.66,
        ac_loads_kwh: 201.4,
        dc_loads_kwh: 9.83,
        charging_kwh: 301.43,
        battery_charged_kwh: 296.1,
        generated_samples: 2740,
        ac_loads_samples: 2712,
        dc_loads_samples: 96,
      },
      daily,
    };
  }
  return {
    ...head,
    kind: "consumption",
    energy: {
      window: "range",
      ac_loads_kwh: 214.9,
      dc_loads_kwh: 10.2,
      battery_discharged_kwh: 305.7,
      grid_import_kwh: null,
      ac_loads_samples: 2712,
      dc_loads_samples: 96,
      battery_discharged_samples: 2740,
      grid_import_samples: 0,
    },
    daily,
  };
}
