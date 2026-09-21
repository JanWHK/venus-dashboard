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
import Icon from "./Icon";

export const number = (value, decimals = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      })
    : "—";
const power = (value) =>
  number(value == null ? null : Math.abs(value) / 1000, 2);
const batteryState = (value) =>
  value == null
    ? "Awaiting data"
    : value > 20
      ? "Charging"
      : value < -20
        ? "Discharging"
        : "Idle";
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

const CHART_COLORS = {
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
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon">
          <Icon name={icon} />
        </span>
      </div>
      <div className="metric-value">
        {power(value)}
        <span>kW</span>
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
  const flow = (v, reverse = false) =>
    live && v != null && Math.abs(v) > 20
      ? `flow-line active ${reverse ? "reverse" : ""}`
      : "flow-line";
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
            d="M139 91H271Q300 91 300 120V165H350"
          />
          <path
            className={flow(m.grid_power, m.grid_power < 0)}
            d="M139 249H271Q300 249 300 215V165H350"
          />
          <path className={flow(m.load_power)} d="M350 165H563" />
          <path
            className={flow(m.battery_power, m.battery_power < 0)}
            d="M350 165V272H450"
          />
        </svg>
        <div className="flow-node solar-node">
          <span className="node-icon">
            <Icon name="sun" size={24} />
          </span>
          <div>
            <span>Solar array</span>
            <strong>
              {power(m.solar_power)} <small>kW</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.solar_power == null
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
              {power(m.grid_power)} <small>kW</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.grid_power == null
              ? "No reading yet"
              : m.grid_power < -20
                ? "Exporting to grid"
                : m.grid_power > 20
                  ? "Importing from grid"
                  : "No grid exchange"}
          </span>
        </div>
        <div className="flow-core">
          <div className="core-ring">
            <Icon name="bolt" size={31} />
          </div>
          <strong>Energy hub</strong>
          <span>Victron system</span>
        </div>
        <div className="flow-node home-node">
          <span className="node-icon">
            <Icon name="home" size={24} />
          </span>
          <div>
            <span>Your home</span>
            <strong>
              {power(m.load_power)} <small>kW</small>
            </strong>
          </div>
          <span className="node-caption">
            {m.load_power == null ? "No reading yet" : "Current consumption"}
          </span>
        </div>
        <div className="flow-battery">
          <Icon name="battery" size={21} />
          <span>{batteryState(m.battery_power)}</span>
          <strong>{power(m.battery_power)} kW</strong>
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
        {m.battery_power != null && ` · ${power(m.battery_power)} kW`}
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

function EnergyChart({ liveData, demo, historyOnly }) {
  const [range, setRange] = useState(historyOnly ? "24h" : "live");
  const [stored, setStored] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const theme = useTheme();
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
                tickFormatter={(v) => `${number(v / 1000, 1)}`}
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(v) => new Date(v).toLocaleString()}
                formatter={(v, name) => [`${number(v / 1000, 2)} kW`, name]}
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
              icon="sun"
              title="Solar generation"
              value={m.solar_power}
              detail={
                m.solar_yield_today == null
                  ? "From your solar array"
                  : `${number(m.solar_yield_today)} kWh harvested today`
              }
              tone="solar-card"
              trend="PV"
            />
            <MetricCard
              icon="home"
              title="Home consumption"
              value={m.load_power}
              detail="Powering your everyday"
              tone="home-card"
              trend="AC"
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
              title="Grid exchange"
              value={m.grid_power}
              detail={
                m.grid_power == null
                  ? "Awaiting grid readings"
                  : m.grid_power < -20
                    ? "Exporting energy"
                    : m.grid_power > 20
                      ? "Importing energy"
                      : "No power exchanged"
              }
              tone="grid-card"
              trend="GRID"
            />
            <MetricCard
              icon="generator"
              title="Generator"
              value={m.generator_power}
              detail={
                generatorState(m.generator_state) ??
                (m.generator_runtime != null
                  ? "Not reported by GX"
                  : "No generator connected")
              }
              tone="generator-card"
              trend={m.generator_runtime != null ? `${generatorRuntime(m.generator_runtime)} total` : "GEN"}
            />
          </div>
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
                {number(m.ac_out_frequency)} Hz
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
