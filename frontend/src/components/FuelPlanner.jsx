import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fuelPlan } from "../fuelPlanner";
import Icon from "./Icon";

const show = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function FuelPlanner({ liveData }) {
  const [targetTime, setTargetTime] = useState("07:00");
  const [minSoc, setMinSoc] = useState("25");
  const [maxSoc, setMaxSoc] = useState("30");
  const [fuelInTank, setFuelInTank] = useState("");
  const [rows, setRows] = useState([]);
  const [calibration, setCalibration] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refresh() {
      const from = new Date(Date.now() - 36 * 3_600_000).toISOString();
      try {
        const [readings, report] = await Promise.all([
          api(`/readings?from=${encodeURIComponent(from)}&limit=500`, { signal: controller.signal }),
          api("/reports/generator", { signal: controller.signal }),
        ]);
        if (active) {
          setRows(readings);
          setCalibration(report.fuel_calibration);
          setError("");
          setNow(Date.now());
        }
      } catch (cause) {
        if (active) setError(cause.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 5 * 60_000);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, []);

  const live = liveData?.status === "live";
  const plan = live && !error ? fuelPlan({
    now, targetTime, minSoc: Number(minSoc), maxSoc: Number(maxSoc),
    currentSoc: liveData?.metrics?.battery_soc, rows,
    litersPerKwh: calibration?.liters_per_kwh, fuelInTank,
  }) : null;
  const accepted = liveData?.metrics?.ac_in_source === "generator" &&
    liveData?.metrics?.ac_in_connected !== false &&
    liveData?.metrics?.ac_in_power > 100;

  return (
    <section className="panel fuel-planner" aria-label="Night fuel planner">
      <div className="panel-heading">
        <div><span className="eyebrow">PLAN THE NIGHT</span><h2>Fuel for the morning.</h2></div>
        <Icon name="moon" size={22} />
      </div>
      <p className="fuel-planner-intro">Estimate petrol to reach your battery goal. Read-only; it never starts the generator.</p>
      <div className="fuel-planner-inputs">
        <label>By <input aria-label="Target time" type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} /></label>
        <label>From % <input aria-label="Minimum target battery" type="number" min="15" max="100" value={minSoc} onChange={(e) => setMinSoc(e.target.value)} /></label>
        <label>To % <input aria-label="Maximum target battery" type="number" min="15" max="100" value={maxSoc} onChange={(e) => setMaxSoc(e.target.value)} /></label>
        <label>Usable fuel in tank, L <input aria-label="Usable fuel already in tank" type="number" min="0" step="0.1" placeholder="Enter manually" value={fuelInTank} onChange={(e) => setFuelInTank(e.target.value)} /></label>
      </div>
      {!live ? <p className="fuel-planner-warning" role="status">Live GX readings required. No fuel estimate while offline or in demo.</p>
        : error ? <p className="fuel-planner-warning" role="status">Could not load recent readings: {error}</p>
          : plan?.reason ? <p className="fuel-planner-warning" role="status">{plan.reason}</p>
            : plan ? <>
              <div className="fuel-planner-result" aria-live="polite">
                <div><span>Generator time</span><strong>{show(plan.lowHours)}–{show(plan.highHours)} h</strong></div>
                <div><span>Estimated fuel</span><strong>{show(plan.litersLow)}–{show(plan.litersHigh)} L</strong></div>
                <div className="fuel-planner-highlight"><span>Allow in tank (25% margin)</span><strong>{show(plan.reserveLiters)} L</strong></div>
                <div><span>Petrol to add</span><strong>{plan.addLiters == null ? "Enter tank fuel" : `${show(plan.addLiters)} L`}</strong></div>
              </div>
              <p className="fuel-planner-note">Based on {show(plan.rates.offHours)} h discharging and {show(plan.rates.generatorHours)} h accepted generator charging in the last 36 h, plus the 11 L / 3-run fuel calibration. No fuel level sensor. Check actual tank capacity and leave room for expansion.</p>
              {!accepted && liveData?.generator_runs?.active_run && <p className="fuel-planner-warning" role="alert">Generator running, but AC input is not confirmed accepted. This estimate may not charge the battery.</p>}
              {plan.belowCriticalIn != null && <p className="fuel-planner-warning" role="alert">At the recent discharge rate, 15% could be reached in about {show(Math.max(0, plan.belowCriticalIn))} h. Start charging before then; this card does not schedule a start.</p>}
              {!plan.canReachUpper && <p className="fuel-planner-warning">The upper target may be out of reach by then.</p>}
            </> : <p className="fuel-planner-note">Loading recent readings…</p>}
    </section>
  );
}
