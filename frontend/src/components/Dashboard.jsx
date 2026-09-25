import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { demoSnapshot } from "../demo";
import { formatPower, setPowerUnit, usePowerUnit } from "../units";
import Icon from "./Icon";
import FuelPlanner from "./FuelPlanner";
import inverterArt from "../assets/victron-inverter.webp";
import batteryArt from "../assets/flow-battery.webp";

export const number = (value, decimals = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      })
    : "—";
const batteryState = (value) =>
  value == null
    ? "Awaiting data"
    : value > 20
      ? "Charging"
      : value < -20
        ? "Discharging"
        : "Idle";
// Show power delivered to the MultiPlus only while it accepts the AC input.
const generatorFeed = (m) =>
  m.ac_in_source === "generator" && m.ac_in_connected !== false
    ? m.ac_in_power
    : null;
const GENERATOR_STATES = {
  0: "Stopped",
  1: "Running",
  2: "Warm-up",
  3: "Cool-down",
  4: "Stopping",
  10: "Error",
};
const generatorState = (code) =>
  code == null ? null : GENERATOR_STATES[code] ?? "Unknown";
const generatorRuntime = (seconds) => {
  if (seconds == null) return null;
  const hours = seconds / 3600;
  return hours >= 10 ? `${number(hours, 0)} h` : `${number(hours)} h`;
};
const INVERTER_STATES = {
  0: "Offline",
  1: "Starting up",
  2: "Fault",
  3: "Low SOC",
  4: "Float",
  5: "Bulk charging",
  6: "Absorption",
  7: "Inverting",
  8: "Assisting",
  9: "Inverting",
};
const inverterState = (code) =>
  code == null ? null : INVERTER_STATES[code] ?? null;
export const formatDuration = (seconds) => {
  if (seconds == null) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};
export const clock = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
const runSummary = (run) => {
  if (!run) return null;
  const duration = formatDuration(run.duration_seconds);
  if (duration == null) return null;
  return `${duration}${run.energy_kwh != null ? ` · ${number(run.energy_kwh, 2)} kWh` : ""}`;
};

export function useTelemetry(demo, path = "/live") {
  const [data, setData] = useState(() => (demo ? demoSnapshot() : null));
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) {
      setData(demoSnapshot());
      setError("");
      return;
    }
    let active = true,
      timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await api(path, { signal: controller.signal });
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError(e.message);
        }
      }
      if (active) timer = setTimeout(poll, path === "/live" ? 2000 : 5000);
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [demo, path]);
  return { data, error };
}

export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "light",
  );
  useEffect(() => {
    const onChange = (event) =>
      setTheme(event.detail || document.documentElement.dataset.theme || "light");
    window.addEventListener("theme-change", onChange);
    return () => window.removeEventListener("theme-change", onChange);
  }, []);
  return theme;
}

export const CHART_COLORS = {
  light: {
    solar_power: "#b3862f",
    load_power: "#2e8c6a",
    grid_power: "#8c98a4",
    generator_power: "#7a5fa0",
    battery_soc: "#d26458",
    gridStroke: "#e9ece6",
    tick: "#849089",
    tooltipBorder: "#dfe5dc",
  },
  dark: {
    solar_power: "#b98b33",
    load_power: "#3fa184",
    grid_power: "#8fa39a",
    generator_power: "#9484e0",
    battery_soc: "#f18a7e",
    gridStroke: "#2b3630",
    tick: "#8b968f",
    tooltipBorder: "#33403a",
  },
};

function MetricCard({ icon, title, value, detail, tone, trend }) {
  const unit = usePowerUnit();
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon">
          <Icon name={icon} />
        </span>
      </div>
      <div className="metric-value">
        {formatPower(value, unit)}
        <span>{unit}</span>
      </div>
      <div className="metric-bottom">
        <span>{detail}</span>
        <span className="metric-trend">{trend}</span>
      </div>
      <div className="card-accent" />
    </article>
  );
}

function Flow({ metrics: m, live, activeRun }) {
  const unit = usePowerUnit();
  const genOut = generatorFeed(m);
  const flow = (v, reverse = false) =>
    live && v != null && Math.abs(v) > 20
      ? `flow-line active ${reverse ? "reverse" : ""}`
      : "flow-line";
  const timeToGo = formatDuration(m.battery_time_to_go);
  return (
    <section className="panel flow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Your energy, in motion.</h2>
        </div>
        <span className={`status-pill ${live ? "is-live" : ""}`}>
          <span className="pulse-dot" />
          {live ? "Live flow" : "Awaiting GX"}
        </span>
      </div>
      <div className="flow-scene">
        <div className="flow-dot-grid" />
        <svg
          className="flow-wires"
          viewBox="0 0 700 330"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className={flow(m.solar_power)}
            d="M139 49H271Q300 49 300 78V165H350"
          />
          <path
            className={flow(m.grid_power, m.grid_power < 0)}
            d="M139 280H271Q300 280 300 251V165H350"
          />
          <path className={flow(genOut)} d="M139 165H307" />
          <path className={flow(m.load_power)} d="M350 165H563" />
          <path
            className={flow(m.battery_power, m.battery_power < 0)}
            d="M350 165V272H450"
          />
        </svg>
        <div className="flow-node solar-node">
          <span className="node-icon">
            <Icon name={m.solar_power ? "sun" : "moon"} size={24} />
          </span>
          <div>
            <span>Solar array</span>
            <strong>
              {formatPower(m.solar_power, unit)} <small>{unit}</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.pv_voltage != null
              ? `PV ${number(m.pv_voltage)} V`
              : m.solar_power == null
                ? "No reading yet"
                : m.solar_power > 20
                  ? "Harvesting sunshine"
                  : "Standing by"}
          </span>
        </div>
        <div className="flow-node grid-node">
          <span className="node-icon">
            <Icon name="grid" size={24} />
          </span>
          <div>
            <span>Grid connection</span>
            <strong>
              {formatPower(m.grid_power, unit)} <small>{unit}</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.ac_in_source === "generator" || m.ac_in_configured_source === "generator"
              ? "Generator uses AC input"
              : m.ac_in_connected === false
                ? "AC input disconnected"
                : m.ac_in_voltage > 0
                  ? `${number(m.ac_in_voltage)} V · ${number(m.ac_in_frequency)} Hz`
                  : m.grid_power == null
                    ? "No reading yet"
                    : m.grid_power < -20
                      ? "Exporting to grid"
                      : m.grid_power > 20
                        ? "Importing from grid"
                        : "No grid exchange"}
          </span>
        </div>
        <div className="flow-node generator-node">
          <span className="node-icon">
            <Icon name="generator" size={24} />
          </span>
          <div>
            <span>Generator</span>
            <strong>
              {formatPower(genOut, unit)} <small>{unit}</small>
            </strong>
          </div>
          <span className="node-caption">
            {activeRun && m.ac_in_connected === false
              ? "Running · AC input disconnected"
              : m.ac_in_source === "generator" && m.ac_in_voltage > 0
              ? `${number(m.ac_in_voltage)} V · ${number(m.ac_in_frequency)} Hz`
              : activeRun
                ? "Running · no accepted input"
                : generatorState(m.generator_state) ??
                  (m.generator_runtime != null ? "Not reported" : "No reading yet")}
          </span>
        </div>
        <div className="flow-core">
          <div className="flow-core-art">
            <img src={inverterArt} alt="" width="800" height="800" decoding="async" />
          </div>
          <strong>Victron system</strong>
          <span>{inverterState(m.inverter_state) ?? "Victron system"}</span>
        </div>
        <div className="flow-node home-node">
          <span className="node-icon">
            <Icon name="home" size={24} />
          </span>
          <div>
            <span>Your home</span>
            <strong>
              {formatPower(m.load_power, unit)} <small>{unit}</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.load_power == null
              ? "No reading yet"
              : m.ac_out_voltage != null
                ? `${number(m.ac_out_voltage)} V · ${number(m.ac_out_frequency)} Hz`
                : "Current consumption"}
          </span>
        </div>
        <div className="flow-battery">
          <span className="flow-battery-art">
            <img src={batteryArt} alt="" width="800" height="800" decoding="async" />
          </span>
          <span className="flow-battery-reading">
            <span>Battery · {batteryState(m.battery_power)}</span>
            <strong>{m.battery_soc == null ? "—" : `${number(m.battery_soc, 0)}%`}</strong>
            <small>{formatPower(m.battery_power, unit)} {unit}{timeToGo && ` · ${timeToGo}`}</small>
          </span>
        </div>
      </div>
      <div className="flow-caption">
        <Icon name="wifi" size={15} />
        <span>Power at a glance. Updates every 2 seconds.</span>
        <Link to="/devices">
          Explore devices <Icon name="arrow" size={14} />
        </Link>
      </div>
    </section>
  );
}

function Battery({ metrics: m }) {
  const unit = usePowerUnit();
  const soc =
    m.battery_soc == null ? 0 : Math.max(0, Math.min(100, m.battery_soc));
  return (
    <section className="panel battery-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ENERGY IN RESERVE</span>
          <h2>Your battery.</h2>
        </div>
        <Icon name="battery" />
      </div>
      <div className="battery-gauge">
        <svg viewBox="0 0 220 165" aria-hidden="true">
          <path
            d="M35 132a87 87 0 1 1 150 0"
            pathLength="100"
            className="gauge-track"
          />
          <path
            d="M35 132a87 87 0 1 1 150 0"
            pathLength="100"
            className="gauge-fill"
            strokeDasharray={`${soc} 100`}
          />
        </svg>
        <div className="gauge-number">
          {number(m.battery_soc, 0)}
          <span>%</span>
          <small>STATE OF CHARGE</small>
        </div>
      </div>
      <span
        className={`battery-state ${m.battery_power < -20 ? "discharging" : ""}`}
      >
        <Icon name="bolt" size={13} />
        {batteryState(m.battery_power)}
        {m.battery_power != null && ` · ${formatPower(m.battery_power, unit)} ${unit}`}
      </span>
      <div className="battery-details">
        <div>
          <span>Voltage</span>
          <strong>
            {number(m.battery_voltage)} <small>V</small>
          </strong>
        </div>
        <div>
          <span>Current</span>
          <strong>
            {number(m.battery_current)} <small>A</small>
          </strong>
        </div>
        <div>
          <span>Temperature</span>
          <strong>
            {number(m.battery_temperature)} <small>°C</small>
          </strong>
        </div>
      </div>
    </section>
  );
}

// These are system-wide readings. No meter attributes AC or DC demand to an
// individual source when solar, generator and battery overlap. The GX DC
// value is a computed residual and can be negative, so only positive values
// contribute to the percentage bar while the signed reading remains visible.
function SystemUsePanel({ metrics: m }) {
  const unit = usePowerUnit();
  const outputs = [
    { key: "loads", label: "AC loads", value: m.load_power, color: "seg-loads" },
    { key: "dc", label: "DC (GX)", value: m.dc_load_power, color: "seg-dc" },
    { key: "charging", label: "Battery charging", tileLabel: m.battery_power < 0 ? "Battery discharging" : "Battery charging", value: m.battery_power, color: "seg-charging" },
  ];
  if (outputs.every(({ value }) => value == null)) return null;
  const positive = outputs.map(({ value }) => Math.max(value ?? 0, 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  const shares = positive.map((value) => (total > 0 ? (value / total) * 100 : 0));
  const rounded = shares.map((share) => Math.floor(share));
  const byRemainder = shares.map((share, index) => ({ index, fraction: share - rounded[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  if (total > 0) {
    const remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < remaining; i += 1) {
      rounded[byRemainder[i].index] += 1;
    }
  }
  return (
    <section className="panel generator-panel system-use-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SYSTEM-WIDE POWER USE</span>
          <h2>Where power goes.</h2>
          <span className="gen-supply">One mix for the whole system, even while solar and generator overlap.</span>
        </div>
      </div>
      <div className="generator-stats system-use-stats">
        {outputs.map(({ key, label, tileLabel, value, color }) => (
          <div className="gen-stat" key={key}>
            <span><i className={`split-swatch ${color.replace("seg-", "split-")}`} />{tileLabel ?? label}</span>
            <strong>{value != null && value < 0 ? "−" : ""}{formatPower(value, unit)} <small>{unit}</small></strong>
          </div>
        ))}
      </div>
      <div className="split-bar" role="img" aria-label={`Positive power-use readings: AC loads ${rounded[0]}%, DC (GX) ${rounded[1]}%, battery charging ${rounded[2]}%`}>
        {outputs.map(({ key, color }, index) => (
          <span key={key} className={color} style={{ width: `${shares[index]}%` }} />
        ))}
      </div>
      <div className="system-use-legend">
        {outputs.map(({ key, label }, index) => <span key={key}>{label} {rounded[index]}%</span>)}
      </div>
      <p className="gen-supply">Percentages compare positive reported readings, not a measured split of each source. DC (GX) is a calculated indication and can be negative; negative values stay visible above but have no positive bar share.</p>
    </section>
  );
}

function GeneratorPanel({ metrics: m, activeRun }) {
  const unit = usePowerUnit();
  const feeding = m.ac_in_source === "generator" && m.ac_in_power != null && m.ac_in_connected !== false;
  const running = Boolean(activeRun) || [1, 2, 3].includes(m.generator_state) || (m.generator_power ?? 0) > 20;
  if (!running && !feeding) return null;
  return (
    <section className="panel generator-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">GENSET RUNNING</span>
          <h2>Generator input.</h2>
          {feeding && (m.ac_in_voltage != null || m.ac_in_frequency != null) && (
            <span className="gen-supply">
              {number(m.ac_in_voltage)} V · {number(m.ac_in_frequency)} Hz
            </span>
          )}
        </div>
        <span className={`status-pill ${feeding ? "is-live" : "is-warning"}`}>
          <span className="pulse-dot" />
          {feeding ? "Feeding the inverter" : "Running · no accepted AC input"}
        </span>
      </div>
      <div className="generator-stats">
        <div className="gen-stat total"><span>Accepted input</span><strong>{formatPower(feeding ? m.ac_in_power : null, unit)} <small>{unit}</small></strong></div>
        <div className="gen-stat"><span>Voltage seen</span><strong>{number(m.ac_in_voltage)} <small>V</small></strong></div>
        <div className="gen-stat"><span>Frequency seen</span><strong>{number(m.ac_in_frequency)} <small>Hz</small></strong></div>
        <div className="gen-stat"><span>This run</span><strong>{formatDuration(activeRun?.duration_seconds) ?? "—"}</strong></div>
      </div>
      {!feeding && <p className="gen-supply" role="status">GX reports generator runtime, but the MultiPlus is not accepting its AC input. The dashboard cannot restore that connection.</p>}
    </section>
  );
}

function SolarPanel({ metrics: m }) {
  const unit = usePowerUnit();
  // Same visibility rule as the sun/moon icon: hidden while idle or dark.
  if (m.solar_power == null || m.solar_power <= 0) return null;
  return (
    <section className="panel generator-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ARRAY PRODUCING</span>
          <h2>Solar input.</h2>
          {(m.pv_voltage != null || m.pv_current != null) && (
            <span className="gen-supply">
              {number(m.pv_voltage)} V · {number(m.pv_current)} A PV
            </span>
          )}
        </div>
        <span className="status-pill is-live">
          <span className="pulse-dot" />
          Harvesting sunshine
        </span>
      </div>
      <div className="generator-stats">
        <div className="gen-stat total"><span>Total harvest</span><strong>{formatPower(m.solar_power, unit)} <small>{unit}</small></strong></div>
        <div className="gen-stat"><span>PV voltage</span><strong>{number(m.pv_voltage)} <small>V</small></strong></div>
        <div className="gen-stat"><span>PV current</span><strong>{number(m.pv_current)} <small>A</small></strong></div>
        <div className="gen-stat"><span>Harvest today</span><strong>{number(m.solar_yield_today, 2)} <small>kWh</small></strong></div>
      </div>
    </section>
  );
}

function EnergyChart({ liveData, demo, historyOnly }) {
  const [range, setRange] = useState(historyOnly ? "24h" : "live");
  const [stored, setStored] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const theme = useTheme();
  const unit = usePowerUnit();
  const colors = CHART_COLORS[theme] || CHART_COLORS.light;
  const [visible, setVisible] = useState({
    solar_power: true,
    load_power: true,
    grid_power: false,
    generator_power: true,
    battery_soc: true,
  });
  useEffect(() => {
    if (range === "live" || demo) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setStored([]);
    setError("");
    const seconds = range === "24h" ? 86400 : 604800;
    api(
      `/readings?from=${encodeURIComponent(new Date(Date.now() - seconds * 1000).toISOString())}&limit=5000`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (active) setStored(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [range, demo]);
  const rows = range === "live" || demo ? liveData?.history || [] : stored;
  const hasData = rows.some((row) =>
    ["solar_power", "load_power", "grid_power", "generator_power", "battery_soc"].some(
      (key) => row[key] != null,
    ),
  );
  const hasBatteryData = rows.some((row) => row.battery_soc != null);
  const series = [
    ["solar_power", "Solar", colors.solar_power],
    ["load_power", "Consumption", colors.load_power],
    ["grid_power", "Grid", colors.grid_power],
    ["generator_power", "Generator", colors.generator_power],
  ];
  const legendSeries = [...series, ["battery_soc", "Battery level", colors.battery_soc]];
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">THE RHYTHM OF YOUR DAY</span>
          <h2>Energy at a glance.</h2>
        </div>
        <div className="segmented" aria-label="Chart time range">
          {[
            ["live", "Live"],
            ["24h", "24 hours"],
            ["7d", "7 days"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={range === key}
              className={range === key ? "selected" : ""}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        {legendSeries.map(([key, label, color]) => (
          <button
            key={key}
            aria-pressed={visible[key]}
            className={visible[key] ? "" : "muted-series"}
            onClick={() =>
              setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
            }
          >
            <span style={{ background: color }} />
            {label}
          </button>
        ))}
        <small>
          {demo
            ? "Illustrative 15-minute sample"
            : range === "live"
              ? "Last 15 minutes · memory only"
              : "Saved summaries · up to 5,000 points"}
        </small>
      </div>
      <div className="chart-body">
        {loading ? (
          <div className="empty-state">
            <Icon name="history" />
            <p>Loading your energy history…</p>
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
          </div>
        ) : !hasData ? (
          <div className="empty-state">
            <Icon name="history" size={30} />
            <strong>
              {range === "live"
                ? "Your energy story starts here."
                : "A little history goes a long way."}
            </strong>
            <p>
              {range === "live"
                ? "The chart fills as live readings arrive from your GX."
                : "Enable lightweight summaries in Settings to build your history."}
            </p>
            {range !== "live" && (
              <Link to="/settings">
                Open settings <Icon name="arrow" size={14} />
              </Link>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 12, right: 0, left: -22, bottom: 0 }}
            >
              <defs>
                {series.map(([key, , color]) => (
                  <linearGradient
                    key={key}
                    id={`gradient-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.19} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke={colors.gridStroke}
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="recorded_at"
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
                minTickGap={45}
              />
              <YAxis
                yAxisId="power"
                tickFormatter={(v) => formatPower(v, unit, 1)}
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
              />
              {visible.battery_soc && hasBatteryData && (
                <YAxis
                  yAxisId="battery"
                  orientation="right"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10, fill: colors.battery_soc }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
              )}
              <Tooltip
                labelFormatter={(v) => new Date(v).toLocaleString()}
                formatter={(v, name) => [
                  name === "Battery level" ? `${number(v, 0)}%` : `${formatPower(v, unit, 2)} ${unit}`,
                  name,
                ]}
                contentStyle={{
                  borderRadius: 12,
                  border: `1px solid ${colors.tooltipBorder}`,
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 12,
                }}
              />
              {series
                .filter(([key]) => visible[key])
                .map(([key, label, color]) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={label}
                    yAxisId="power"
                    stroke={color}
                    fill={`url(#gradient-${key})`}
                    strokeWidth={2}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              {visible.battery_soc && hasBatteryData && (
                <Line
                  type="monotone"
                  dataKey="battery_soc"
                  name="Battery level"
                  yAxisId="battery"
                  stroke={colors.battery_soc}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

export default function Dashboard({ demo, historyOnly = false }) {
  const { data, error } = useTelemetry(demo);
  const unit = usePowerUnit();
  const m = data?.metrics || {};
  const live = data?.status === "live";
  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {historyOnly ? "A LONGER VIEW" : "A GOOD DAY FOR GOOD ENERGY"}
          </span>
          <h1>{historyOnly ? "Your energy story." : "Hello, brighter day."}</h1>
          <p>
            {historyOnly
              ? "The bigger picture, without keeping every detail."
              : "A little sunshine. A lot of possibility. Here’s your system right now."}
          </p>
        </div>
        <div className="heading-side">
          {!historyOnly && (
            <div className="segmented unit-segmented" role="group" aria-label="Power unit">
              {["kW", "W"].map((u) => (
                <button
                  key={u}
                  aria-pressed={unit === u}
                  className={unit === u ? "selected" : ""}
                  onClick={() => setPowerUnit(u)}
                >
                  {u}
                </button>
              ))}
            </div>
          )}
          <div className={`connection-label ${live ? "connected" : ""}`}>
            <span className="pulse-dot" />
            <div>
              <strong>
                {demo
                  ? "Demo system"
                  : live
                    ? "System connected"
                    : data?.status === "waiting"
                      ? "Waiting for readings"
                      : "GX not connected"}
              </strong>
              <span>
                {demo ? "Illustrative readings" : data?.host || "192.168.21.10"}
              </span>
            </div>
          </div>
        </div>
      </div>
      {!demo && !live && (
        <div className="connection-notice" role="status">
          <Icon name="wifi" size={20} />
          <div>
            <strong>
              {error
                ? "Workspace connection interrupted"
                : "Waiting for your GX"}
            </strong>
            <span>
              {error ||
                data?.error ||
                "Live readings will appear when your GX MQTT connection is available."}
            </span>
          </div>
          <Link to="/settings">
            Connection details <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
      {!historyOnly && (
        <>
          <div className="metric-grid five">
            <MetricCard
              icon={m.solar_power ? "sun" : "moon"}
              title="Solar generation"
              value={m.solar_power}
              detail={
                m.solar_yield_today == null
                  ? "From your solar array"
                  : `${number(m.solar_yield_today)} kWh harvested today`
              }
              tone="solar-card"
              trend={m.pv_voltage != null ? `${number(m.pv_voltage)} V PV` : "PV"}
            />
            <MetricCard
              icon="home"
              title="Home consumption"
              value={m.load_power}
              detail="Powering your everyday"
              tone="home-card"
              trend={m.ac_out_current != null ? `${number(m.ac_out_current)} A AC` : "AC"}
            />
            <MetricCard
              icon="battery"
              title="Battery power"
              value={m.battery_power}
              detail={batteryState(m.battery_power)}
              tone="battery-card"
              trend="DC"
            />
            <MetricCard
              icon="grid"
              title={m.ac_in_configured_source === "generator" || m.ac_in_source === "generator" ? "AC input" : "Grid exchange"}
              value={m.ac_in_configured_source === "generator" || m.ac_in_source === "generator" ? m.ac_in_power : m.grid_power}
              detail={
                m.ac_in_connected === false && m.ac_in_configured_source === "generator"
                  ? "Generator AC input disconnected"
                  : m.ac_in_source === "generator"
                  ? "Fed by the generator"
                  : m.grid_power == null
                    ? "Awaiting grid readings"
                    : m.grid_power < -20
                      ? "Exporting energy"
                      : m.grid_power > 20
                        ? "Importing energy"
                        : "No power exchanged"
              }
              tone="grid-card"
              trend={
                m.ac_in_connected === false
                  ? "DISCONNECTED"
                  : m.ac_in_frequency > 0
                  ? `${number(m.ac_in_frequency)} Hz ${m.ac_in_source === "generator" ? "AC IN" : "GRID"}`
                  : m.ac_in_source === "generator"
                    ? "AC IN"
                    : "GRID"
              }
            />
            <MetricCard
              icon="generator"
              title="Generator"
              value={generatorFeed(m)}
              detail={(() => {
                const runs = data?.generator_runs;
                if (runs?.active_run) {
                  if (m.ac_in_connected === false) return "Running · AC input disconnected";
                  if (generatorFeed(m) == null) return "Running · no accepted input power";
                  return `Feeding inverter · since ${clock(runs.active_run.started_at)}`;
                }
                if (m.ac_in_source === "generator") return "Feeding the inverter";
                const last = runSummary(runs?.recent?.[0]);
                if (last) return `Last run ${last}`;
                return (
                  generatorState(m.generator_state) ??
                  (m.generator_runtime != null
                    ? "Not reported by GX"
                    : "No generator connected")
                );
              })()}
              tone="generator-card"
              trend={
                m.generator_runtime != null
                  ? `${generatorRuntime(m.generator_runtime)} total`
                  : "GEN"
              }
            />
          </div>
          <SolarPanel metrics={m} />
          <GeneratorPanel metrics={m} activeRun={data?.generator_runs?.active_run} />
          {!demo && <FuelPlanner liveData={data} />}
          <SystemUsePanel metrics={m} />
          <div className="energy-grid">
            <Flow metrics={m} live={live} activeRun={data?.generator_runs?.active_run} />
            <Battery metrics={m} />
          </div>
        </>
      )}
      <div className={historyOnly ? "history-layout" : "bottom-grid"}>
        <EnergyChart
          key={String(historyOnly)}
          liveData={data}
          demo={demo}
          historyOnly={historyOnly}
        />
        {!historyOnly && (
          <section className="panel system-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LOOKING GOOD?</span>
                <h2>System pulse.</h2>
              </div>
              <Icon name="devices" />
            </div>
            <div className="system-row">
              <span>Reporting devices</span>
              <strong>{data?.device_count ?? "—"}</strong>
            </div>
            <div className="system-row">
              <span>Live data points</span>
              <strong>{data?.topic_count ?? "—"}</strong>
            </div>
            <div className="system-row">
              <span>AC output</span>
              <strong>
                {number(m.ac_out_voltage)} V <span> / </span>
                {number(m.ac_out_current)} A <span> / </span>
                {number(m.ac_out_frequency)} Hz
              </strong>
            </div>
            <div className="system-row">
              <span>DC loads</span>
              <strong>
                {m.dc_load_power != null
                  ? `${formatPower(m.dc_load_power, unit)} ${unit}`
                  : "—"}
              </strong>
            </div>
            <div className="system-row">
              <span>PV array</span>
              <strong>
                {m.pv_voltage != null ? `${number(m.pv_voltage)} V` : "—"}
              </strong>
            </div>
            <div className="system-row">
              <span>Generator</span>
              <strong>
                {generatorState(m.generator_state) ?? "—"}
                {m.generator_runtime != null &&
                  ` · ${generatorRuntime(m.generator_runtime)}`}
              </strong>
            </div>
            <div className="system-row">
              <span>Last run</span>
              <strong>{(() => {
                const runs = data?.generator_runs;
                const active = runs?.active_run;
                if (active) {
                  const sofar = runSummary(active) ?? `since ${clock(active.started_at)}`;
                  return `Running ${sofar} · since ${clock(active.started_at)}`;
                }
                const last = runs?.recent?.[0];
                if (last) {
                  const summary = runSummary(last) ?? "—";
                  return `${summary} · ended ${clock(last.ended_at) ?? "—"}`;
                }
                return "—";
              })()}</strong>
            </div>
            <div className="system-row">
              <span>Active alarms</span>
              <strong className={data?.alarms?.length ? "alarm-text" : ""}>
                {live ? data.alarms.length : "—"}
              </strong>
            </div>
            {data?.alarms?.slice(0, 3).map((alarm, i) => (
              <p className="alarm-text" key={i}>
                {alarm.device}: {alarm.name}
              </p>
            ))}
            <Link className="system-link" to="/devices">
              See what’s connected <Icon name="arrow" size={17} />
            </Link>
            <div className="storage-note">
              <Icon name="leaf" size={17} />
              <span>
                {data?.recording_interval
                  ? `One summary every ${data.recording_interval / 60} minutes.`
                  : "Live by nature. No detailed logging."}
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
