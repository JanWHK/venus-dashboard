import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { demoReport } from "../demo";
import { formatPower, usePowerUnit } from "../units";
import { CHART_COLORS, formatDuration, number, useTheme } from "./Dashboard";
import Icon from "./Icon";

const KINDS = [
  ["generator", "Generator"],
  ["solar", "Solar"],
  ["consumption", "Consumption"],
];
const PRESETS = [
  ["7d", "7 days", 7],
  ["30d", "30 days", 30],
  ["90d", "90 days", 90],
];

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};
const dayBack = (days) => startOfDay(Date.now() - (days - 1) * 86400000);
const inputDate = (date) => date.toLocaleDateString("en-CA");
const dayLabel = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
const fullDate = (iso) => new Date(iso).toLocaleString();

function Tiles({ children }) {
  return <div className="generator-stats">{children}</div>;
}
function Tile({ label, value, unit, detail, swatch, title, total }) {
  return (
    <div className={total ? "gen-stat total" : "gen-stat"}>
      <span title={title}>
        {swatch && <i className={`split-swatch ${swatch}`} />}
        {label}
      </span>
      <strong>
        {value} {unit && <small>{unit}</small>}
      </strong>
      {detail && <span className="gen-stat-detail">{detail}</span>}
    </div>
  );
}

// Part-to-whole energy split, mirroring the live generator panel: the last
// segment is the remainder so the labels always sum to 100 %.
function SplitBar({ total, segments }) {
  if (total == null || total <= 0) return null;
  const share = (value) =>
    value != null ? Math.min(Math.max((value / total) * 100, 0), 100) : null;
  const leading = segments.slice(0, -1);
  const leadingShares = leading.map((segment) => share(segment.value));
  const remainder = Math.max(
    0,
    100 -
      leadingShares.reduce((sum, value) => sum + (value != null ? Math.round(value) : 0), 0),
  );
  return (
    <>
      <div
        className="split-bar"
        role="img"
        aria-label={`${segments
          .map((segment) => `${segment.label} ${number(segment.value, 2)} kWh`)
          .join(", ")}`}
      >
        {segments.map((segment, index) => {
          const width = index < segments.length - 1 ? share(segment.value) : null;
          if (segment.value == null && index < segments.length - 1) return null;
          return (
            <span
              key={segment.key}
              className={segment.key}
              style={width != null ? { width: `${width}%` } : { flexGrow: 1 }}
              title={`${segment.label}: ${number(segment.value, 2)} kWh`}
            />
          );
        })}
      </div>
      <div className="split-labels" aria-hidden="true">
        {leading.map((segment, index) =>
          leadingShares[index] == null ? null : (
            <span key={segment.key} style={{ width: `${leadingShares[index]}%` }}>
              {Math.round(leadingShares[index])}%
            </span>
          ),
        )}
        <span style={{ flexGrow: 1 }}>{remainder}%</span>
      </div>
    </>
  );
}

function DailyChart({ daily, color }) {
  const theme = useTheme();
  const colors = CHART_COLORS[theme] || CHART_COLORS.light;
  if (!daily?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={daily} margin={{ top: 12, right: 5, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={colors.gridStroke} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => dayLabel(`${v}T12:00:00`)}
          tick={{ fontSize: 10, fill: colors.tick }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v) => number(v, 0)}
          tick={{ fontSize: 10, fill: colors.tick }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: colors.gridStroke, opacity: 0.5 }}
          labelFormatter={(v) => dayLabel(`${v}T12:00:00`)}
          formatter={(v) => [`${number(v, 2)} kWh`, "Energy"]}
          contentStyle={{
            borderRadius: 12,
            border: `1px solid ${colors.tooltipBorder}`,
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 12,
          }}
        />
        <Bar
          dataKey="energy_kwh"
          name="Energy"
          fill={color}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RunsTable({ runs }) {
  if (!runs?.length) return null;
  return (
    <div className="report-table-scroll">
      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Start</th>
            <th scope="col">Duration</th>
            <th scope="col">Energy</th>
            <th scope="col">Peak output</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.started_at}>
              <td data-label="Start">{fullDate(run.started_at)}</td>
              <td data-label="Duration">{formatDuration(run.duration_seconds) ?? "—"}</td>
              <td data-label="Energy">
                {run.energy_kwh != null ? `${number(run.energy_kwh, 2)} kWh` : "—"}
              </td>
              <td data-label="Peak output">
                {run.peak_power_w != null ? `${number(run.peak_power_w, 0)} W` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const kWh = (value) => (value != null ? number(value, 2) : "—");

// The GX aggregates always-on DC load (Dc/System) and updates it every
// second live; summaries store a snapshot every 15 minutes, which captures
// a constant DC load accurately — but only since 22 Sep 2026.
function DcCoverageNote({ energy }) {
  const baseline = energy.ac_loads_samples;
  if (!baseline || energy.dc_loads_samples === baseline) return null;
  return (
    <p className="report-note">
      {energy.dc_loads_samples === 0
        ? "DC loads (GX) aren't in saved summaries before 22 Sep 2026 — until then the charging share includes them."
        : `DC loads (GX) only started landing in saved summaries on 22 Sep 2026 — earlier days in this range don't include them (${number(energy.dc_loads_samples, 0)} of ${number(baseline, 0)} summaries carry it).`}
    </p>
  );
}

function GeneratorReport({ data, unit }) {
  const runs = data.runs;
  const energy = data.energy;
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">GENSET OUTPUT</span>
            <h2>What the generator delivered.</h2>
          </div>
        </div>
        <Tiles>
          <Tile
            total
            label="Total output"
            value={kWh(runs.energy_kwh)}
            unit="kWh"
            detail={
              runs.count
                ? `${number(runs.energy_known_runs, 0)} of ${number(runs.count, 0)} runs metered`
                : "No runs in this period"
            }
          />
          <Tile
            label="Runs"
            value={number(runs.count, 0)}
            detail={
              runs.avg_duration_seconds != null
                ? `Average ${formatDuration(runs.avg_duration_seconds)}`
                : undefined
            }
          />
          <Tile
            label="Total runtime"
            value={formatDuration(runs.total_duration_seconds) ?? "—"}
            detail={
              runs.max_duration_seconds != null
                ? `Longest ${formatDuration(runs.max_duration_seconds)}`
                : undefined
            }
          />
          <Tile
            label="Peak output"
            value={runs.peak_power_w != null ? formatPower(runs.peak_power_w, unit) : "—"}
            unit={runs.peak_power_w != null ? unit : undefined}
          />
        </Tiles>
      </section>
      {energy ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">WHERE IT WENT</span>
              <h2>Energy split during runs.</h2>
              <span className="gen-supply">
                Integrated from {number(energy.total_in_samples, 0)} saved summaries ·
                charging is the remainder, as on the live panel.
              </span>
            </div>
          </div>
          <DcCoverageNote energy={energy} />
          <Tiles>
            <Tile
              total
              label="Genset in"
              value={kWh(energy.genset_kwh)}
              unit="kWh"
              detail="From saved summaries, trapezoid"
            />
            <Tile
              label="To AC loads"
              swatch="split-loads"
              value={kWh(energy.ac_loads_kwh)}
              unit="kWh"
            />
            <Tile
              label="DC loads (GX)"
              swatch="split-dc"
              title="GX-computed DC system indication (Dc/System) — updated every second live, snapshotted every 15 minutes; it is a residual, not a meter, and can swing by a couple hundred watts"
              value={kWh(energy.dc_loads_kwh)}
              unit="kWh"
            />
            <Tile
              label="To battery charging"
              swatch="split-charging"
              value={kWh(energy.charging_kwh)}
              unit="kWh"
              detail={
                energy.battery_charged_kwh != null
                  ? `Battery saw ${number(energy.battery_charged_kwh, 2)} kWh in`
                  : undefined
              }
            />
          </Tiles>
          <SplitBar
            total={energy.genset_kwh}
            segments={[
              { key: "seg-loads", label: "To AC loads", value: energy.ac_loads_kwh },
              { key: "seg-dc", label: "DC loads (GX)", value: energy.dc_loads_kwh },
              {
                key: "seg-charging",
                label: "To battery charging",
                value: energy.charging_kwh,
              },
            ]}
          />
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <Icon name="generator" size={30} />
            <strong>No saved summaries in this period.</strong>
            <p>
              The energy split needs saved summaries — enable them in Settings, or pick
              a wider range. Run times below still come from the generator counter.
            </p>
            <Link to="/settings">
              Open settings <Icon name="arrow" size={14} />
            </Link>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DAY BY DAY</span>
            <h2>Generator energy per day.</h2>
          </div>
        </div>
        <div className="report-chart">
          {data.daily.length ? (
            <DailyChart daily={data.daily} color="#7a5fa0" />
          ) : (
            <div className="empty-state">
              <p>No generator runs started in this period.</p>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EVERY RUN</span>
            <h2>Run log.</h2>
            <span className="gen-supply">
              Newest first · runs without power telemetry show no energy yet.
            </span>
          </div>
        </div>
        <RunsTable runs={data.run_list} />
      </section>
    </>
  );
}

function SolarReport({ data }) {
  const energy = data.energy;
  return (
    <>
      {energy ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THE ARRAY AT WORK</span>
              <h2>Where the sun's energy went.</h2>
              <span className="gen-supply">
                Integrated from {number(energy.generated_samples, 0)} saved summaries over
                the whole period.
              </span>
            </div>
          </div>
          <DcCoverageNote energy={energy} />
          <Tiles>
            <Tile total label="Total harvest" value={kWh(energy.generated_kwh)} unit="kWh" />
            <Tile
              label="To AC loads"
              swatch="split-loads"
              value={kWh(energy.ac_loads_kwh)}
              unit="kWh"
            />
            <Tile
              label="DC loads (GX)"
              swatch="split-dc"
              title="GX-computed DC system indication (Dc/System) — updated every second live, snapshotted every 15 minutes; it is a residual, not a meter, and can swing by a couple hundred watts"
              value={kWh(energy.dc_loads_kwh)}
              unit="kWh"
            />
            <Tile
              label="To battery charging"
              swatch="split-charging"
              value={kWh(energy.charging_kwh)}
              unit="kWh"
            />
          </Tiles>
          <SplitBar
            total={energy.generated_kwh}
            segments={[
              { key: "seg-loads", label: "To AC loads", value: energy.ac_loads_kwh },
              { key: "seg-dc", label: "DC loads (GX)", value: energy.dc_loads_kwh },
              {
                key: "seg-charging",
                label: "To battery charging",
                value: energy.charging_kwh,
              },
            ]}
          />
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <Icon name="sun" size={30} />
            <strong>No saved summaries in this period.</strong>
            <p>Enable lightweight summaries in Settings to build your history.</p>
            <Link to="/settings">
              Open settings <Icon name="arrow" size={14} />
            </Link>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DAY BY DAY</span>
            <h2>Solar energy per day.</h2>
          </div>
        </div>
        <div className="report-chart">
          {data.daily.length ? (
            <DailyChart daily={data.daily} color="#b3862f" />
          ) : (
            <div className="empty-state">
              <p>No harvest recorded in this period.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ConsumptionReport({ data }) {
  const energy = data.energy;
  return (
    <>
      {energy ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">WHAT DREW POWER</span>
              <h2>Consumption over the period.</h2>
              <span className="gen-supply">
                Integrated from saved summaries over the whole period.
              </span>
            </div>
          </div>
          <Tiles>
            <Tile total label="AC loads" value={kWh(energy.ac_loads_kwh)} unit="kWh" />
            <Tile
              label="DC loads (GX)"
              title="GX-computed DC system indication (Dc/System) — updated every second live, snapshotted every 15 minutes; it is a residual, not a meter, and can swing by a couple hundred watts"
              value={kWh(energy.dc_loads_kwh)}
              unit="kWh"
            />
            <Tile
              label="Battery discharged"
              value={kWh(energy.battery_discharged_kwh)}
              unit="kWh"
            />
            <Tile
              label="Grid import"
              value={kWh(energy.grid_import_kwh)}
              unit="kWh"
              detail={
                energy.grid_import_kwh == null ? "No grid recorded" : undefined
              }
            />
          </Tiles>
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <Icon name="home" size={30} />
            <strong>No saved summaries in this period.</strong>
            <p>Enable lightweight summaries in Settings to build your history.</p>
            <Link to="/settings">
              Open settings <Icon name="arrow" size={14} />
            </Link>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DAY BY DAY</span>
            <h2>AC consumption per day.</h2>
          </div>
        </div>
        <div className="report-chart">
          {data.daily.length ? (
            <DailyChart daily={data.daily} color="#2e8c6a" />
          ) : (
            <div className="empty-state">
              <p>No consumption recorded in this period.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default function Reports({ demo }) {
  const [kind, setKind] = useState("generator");
  const [range, setRange] = useState(() => ({
    key: "30d",
    from: dayBack(30),
    to: endOfDay(Date.now()),
  }));
  const [custom, setCustom] = useState({
    from: inputDate(dayBack(30)),
    to: inputDate(new Date()),
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const unit = usePowerUnit();

  useEffect(() => {
    if (demo) {
      setData(demoReport(kind));
      setError("");
      return;
    }
    if (range.from > range.to) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const tzOffset = -new Date().getTimezoneOffset();
    api(
      `/reports/${kind}?from=${encodeURIComponent(range.from.toISOString())}` +
        `&to=${encodeURIComponent(range.to.toISOString())}` +
        `&tz_offset_minutes=${tzOffset}`,
      { signal: controller.signal },
    )
      .then((next) => {
        if (active) setData(next);
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
  }, [kind, range, demo]);

  const invalidRange = range.from > range.to;
  const pickPreset = ([key, , days]) =>
    setRange({ key, from: dayBack(days), to: endOfDay(Date.now()) });
  const pickCustomDate = (edge) => (event) => {
    const next = { ...custom, [edge]: event.target.value };
    setCustom(next);
    setRange({
      key: "custom",
      from: startOfDay(next.from),
      to: endOfDay(next.to),
    });
  };
  const rangeText = invalidRange
    ? "Start date must be on or before end date."
    : `${range.from.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })} – ${range.to.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;

  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE BIGGER PICTURE</span>
          <h1>Reports.</h1>
          <p>Totals for a chosen period, from your saved summaries and run log.</p>
        </div>
      </div>
      <div className="report-toolbar">
        <div className="segmented" aria-label="Report type">
          {KINDS.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={kind === value}
              className={kind === value ? "selected" : ""}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="report-date-inputs">
          <div className="segmented" aria-label="Report period">
            {PRESETS.map(([key, label]) => (
              <button
                key={key}
                aria-pressed={range.key === key}
                className={range.key === key ? "selected" : ""}
                onClick={() => pickPreset(PRESETS.find(([value]) => value === key))}
              >
                {label}
              </button>
            ))}
            <button
              aria-pressed={range.key === "custom"}
              className={range.key === "custom" ? "selected" : ""}
              onClick={() =>
                setRange({ key: "custom", from: startOfDay(custom.from), to: endOfDay(custom.to) })
              }
            >
              Custom
            </button>
          </div>
          <input
            type="date"
            aria-label="Start date"
            value={custom.from}
            max={custom.to}
            onChange={pickCustomDate("from")}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="End date"
            value={custom.to}
            min={custom.from}
            onChange={pickCustomDate("to")}
          />
        </div>
      </div>
      <p className="report-range-note">{rangeText}</p>
      {loading && !data ? (
        <div className="empty-state">Crunching your energy totals…</div>
      ) : error ? (
        <div className="empty-state" role="alert">
          <p>{error}</p>
        </div>
      ) : invalidRange ? (
        <div className="empty-state">
          <p>Pick a start date on or before the end date.</p>
        </div>
      ) : data ? (
        <div className={loading ? "report-refreshing" : ""}>
          {data.samples.complete === false && (
            <p className="report-note">
              This range holds more summaries than one report can carry — showing the
              newest 50,000. Narrow the range for exact totals.
            </p>
          )}
          {data.kind === kind && kind === "generator" && (
            <GeneratorReport data={data} unit={unit} />
          )}
          {data.kind === kind && kind === "solar" && <SolarReport data={data} />}
          {data.kind === kind && kind === "consumption" && (
            <ConsumptionReport data={data} />
          )}
        </div>
      ) : (
        <div className="empty-state">Crunching your energy totals…</div>
      )}
    </div>
  );
}
