import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { demoSnapshot } from "../demo";
import { formatPower, setPowerUnit, usePowerUnit } from "../units";
import Icon from "./Icon";

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
// Power the generator is feeding into the MultiPlus: genset telemetry when
// it exists, otherwise the AC-in reading while input 2 (generator) is active.
const generatorFeed = (m) =>
  m.ac_in_source === "generator"
    ? m.generator_power ?? m.ac_in_power
    : m.generator_power;
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
    gridStroke: "#e9ece6",
    tick: "#849089",
    tooltipBorder: "#dfe5dc",
  },
  dark: {
    solar_power: "#b98b33",
    load_power: "#3fa184",
    grid_power: "#8fa39a",
    generator_power: "#9484e0",
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

function Flow({ metrics: m, live }) {
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
            <span>{m.ac_in_source === "generator" ? "AC input" : "Grid connection"}</span>
            <strong>
              {formatPower(m.grid_power, unit)} <small>{unit}</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.ac_in_voltage > 0
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
            {m.ac_in_source === "generator" && m.ac_in_voltage > 0
              ? `${number(m.ac_in_voltage)} V · ${number(m.ac_in_frequency)} Hz`
              : generatorState(m.generator_state) ??
                (m.generator_runtime != null ? "Not reported" : "No reading yet")}
          </span>
        </div>
        <div className="flow-core">
          <div className="core-ring">
            <Icon name="bolt" size={31} />
          </div>
          <strong>Energy hub</strong>
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
          <Icon name="battery" size={21} />
          <span>
            {batteryState(m.battery_power)}
            {timeToGo && ` · ${timeToGo}`}
          </span>
          <strong>
            {formatPower(m.battery_power, unit)} {unit}
          </strong>
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

function GeneratorPanel({ metrics: m, activeRun }) {
  const unit = usePowerUnit();
  if (m.ac_in_source !== "generator" || m.ac_in_power == null) return null;
  const total = m.ac_in_power;
  const loads = m.load_power;
  const dcLoads = m.dc_load_power;
  // Battery charging is the remainder after AC and DC loads, keeping the
  // identity exact: total in = AC loads + DC loads (GX) + battery charging.
  const charging = Math.max(total - (loads ?? 0) - (dcLoads ?? 0), 0);
  const share = (value) =>
    value != null && total > 0 ? Math.min(Math.max((value / total) * 100, 0), 100) : null;
  const loadsShare = share(loads);
  const dcShare = share(dcLoads);
  return (
    <section className="panel generator-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">GENSET RUNNING</span>
          <h2>Generator input.</h2>
          {(m.ac_in_voltage != null || m.ac_in_frequency != null) && (
            <span className="gen-supply">
              {number(m.ac_in_voltage)} V · {number(m.ac_in_frequency)} Hz
            </span>
          )}
        </div>
        <span className="status-pill is-live">
          <span className="pulse-dot" />
          {activeRun ? `Running since ${clock(activeRun.started_at)}` : "Feeding the inverter"}
        </span>
      </div>
      <div className="generator-stats">
        <div className="gen-stat total">
          <span>Total in</span>
          <strong>
            {formatPower(total, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span>
            <i className="split-swatch split-loads" />
            To AC loads
          </span>
          <strong>
            {formatPower(loads, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span title="GX Dc/System aggregate">
            <i className="split-swatch split-dc" />
            DC loads
          </span>
          <strong>
            {formatPower(dcLoads, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span>
            <i className="split-swatch split-charging" />
            To battery charging
          </span>
          <strong>
            {formatPower(charging, unit)} <small>{unit}</small>
          </strong>
        </div>
      </div>
      <div
        className="split-bar"
        role="img"
        aria-label={`Generator input ${formatPower(total, unit)} ${unit}: AC loads ${formatPower(loads, unit)} ${unit}, DC loads ${formatPower(dcLoads, unit)} ${unit}, battery charging ${formatPower(charging, unit)} ${unit}`}
      >
        {loadsShare != null && (
          <span
            className="seg-loads"
            style={{ width: `${loadsShare}%` }}
            title={`To AC loads: ${formatPower(loads, unit)} ${unit}`}
          />
        )}
        {dcShare != null && (
          <span
            className="seg-dc"
            style={{ width: `${dcShare}%` }}
            title={`DC loads: ${formatPower(dcLoads, unit)} ${unit}`}
          />
        )}
        <span
          className="seg-charging"
          style={{ flexGrow: 1 }}
          title={`To battery charging: ${formatPower(charging, unit)} ${unit}`}
        />
      </div>
      <div className="split-labels" aria-hidden="true">
        {loadsShare != null && <span style={{ width: `${loadsShare}%` }}>{Math.round(loadsShare)}%</span>}
        {dcShare != null && <span style={{ width: `${dcShare}%` }}>{Math.round(dcShare)}%</span>}
        <span style={{ flexGrow: 1 }}>
          {Math.max(0, 100 - (loadsShare != null ? Math.round(loadsShare) : 0) - (dcShare != null ? Math.round(dcShare) : 0))}%
        </span>
      </div>
    </section>
  );
}

function SolarPanel({ metrics: m }) {
  const unit = usePowerUnit();
  // Same visibility rule as the sun/moon icon: hidden while idle or dark.
  if (m.solar_power == null || m.solar_power <= 0) return null;
  const total = m.solar_power;
  const loads = m.load_power;
  const dcLoads = m.dc_load_power;
  // Same remainder identity as the generator panel: the array covers AC and
  // DC loads first, and whatever is left charges the battery.
  const charging = Math.max(total - (loads ?? 0) - (dcLoads ?? 0), 0);
  const share = (value) =>
    value != null && total > 0 ? Math.min(Math.max((value / total) * 100, 0), 100) : null;
  const loadsShare = share(loads);
  const dcShare = share(dcLoads);
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
        <div className="gen-stat total">
          <span>Total harvest</span>
          <strong>
            {formatPower(total, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span>
            <i className="split-swatch split-loads" />
            To AC loads
          </span>
          <strong>
            {formatPower(loads, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span title="GX Dc/System aggregate">
            <i className="split-swatch split-dc" />
            DC loads
          </span>
          <strong>
            {formatPower(dcLoads, unit)} <small>{unit}</small>
          </strong>
        </div>
        <div className="gen-stat">
          <span>
            <i className="split-swatch split-charging" />
            To battery charging
          </span>
          <strong>
            {formatPower(charging, unit)} <small>{unit}</small>
          </strong>
        </div>
      </div>
      <div
        className="split-bar"
        role="img"
        aria-label={`Solar harvest ${formatPower(total, unit)} ${unit}: AC loads ${formatPower(loads, unit)} ${unit}, DC loads ${formatPower(dcLoads, unit)} ${unit}, battery charging ${formatPower(charging, unit)} ${unit}`}
      >
        {loadsShare != null && (
          <span
            className="seg-loads"
            style={{ width: `${loadsShare}%` }}
            title={`To AC loads: ${formatPower(loads, unit)} ${unit}`}
          />
        )}
        {dcShare != null && (
          <span
            className="seg-dc"
            style={{ width: `${dcShare}%` }}
            title={`DC loads: ${formatPower(dcLoads, unit)} ${unit}`}
          />
        )}
        <span
          className="seg-charging"
          style={{ flexGrow: 1 }}
          title={`To battery charging: ${formatPower(charging, unit)} ${unit}`}
        />
      </div>
      <div className="split-labels" aria-hidden="true">
        {loadsShare != null && <span style={{ width: `${loadsShare}%` }}>{Math.round(loadsShare)}%</span>}
        {dcShare != null && <span style={{ width: `${dcShare}%` }}>{Math.round(dcShare)}%</span>}
        <span style={{ flexGrow: 1 }}>
          {Math.max(0, 100 - (loadsShare != null ? Math.round(loadsShare) : 0) - (dcShare != null ? Math.round(dcShare) : 0))}%
        </span>
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
    ["solar_power", "load_power", "grid_power", "generator_power"].some(
      (key) => row[key] != null,
    ),
  );
  const series = [
    ["solar_power", "Solar", colors.solar_power],
    ["load_power", "Consumption", colors.load_power],
    ["grid_power", "Grid", colors.grid_power],
    ["generator_power", "Generator", colors.generator_power],
  ];
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
        {series.map(([key, label, color]) => (
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
            <AreaChart
              data={rows}
              margin={{ top: 12, right: 5, left: -22, bottom: 0 }}
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
                tickFormatter={(v) => formatPower(v, unit, 1)}
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(v) => new Date(v).toLocaleString()}
                formatter={(v, name) => [`${formatPower(v, unit, 2)} ${unit}`, name]}
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
                    stroke={color}
                    fill={`url(#gradient-${key})`}
                    strokeWidth={2}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
            </AreaChart>
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
              title={m.ac_in_source === "generator" ? "AC input" : "Grid exchange"}
              value={m.grid_power}
              detail={
                m.ac_in_source === "generator"
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
                m.ac_in_frequency > 0
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
                if (runs?.active_run)
                  return `Running · since ${clock(runs.active_run.started_at)}`;
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
          <div className="energy-grid">
            <Flow metrics={m} live={live} />
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
