const HOUR = 3_600_000;

export function nextTargetTime(now, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target;
}

// Use only consecutive, low-solar summary intervals. A generator interval must
// show both genset output and accepted AC input; a running engine alone is not enough.
export function recentRates(rows, now) {
  const samples = [...rows].filter((row) => Number.isFinite(Date.parse(row.recorded_at)))
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const cutoff = now - 36 * HOUR;
  const totals = { off: { hours: 0, soc: 0, kwh: 0, latest: 0 },
    generator: { hours: 0, soc: 0, kwh: 0, latest: 0 } };
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1], b = samples[i];
    const ta = Date.parse(a.recorded_at), tb = Date.parse(b.recorded_at);
    const hours = (tb - ta) / HOUR;
    if (ta < cutoff || tb > now + 60_000 || hours < 0.05 || hours > 0.6) continue;
    if (![a.battery_soc, b.battery_soc, a.solar_power, b.solar_power]
      .every(Number.isFinite) || a.solar_power > 50 || b.solar_power > 50) continue;
    const accepted = [a, b].every((row) => row.generator_power > 100 && row.ac_in_power > 100);
    const off = [a, b].every((row) => (row.generator_power ?? 0) < 50 &&
      (row.ac_in_power ?? 0) < 50);
    if (!accepted && !off) continue;
    const bucket = totals[accepted ? "generator" : "off"];
    bucket.hours += hours;
    bucket.soc += b.battery_soc - a.battery_soc;
    if (accepted) bucket.kwh += (a.generator_power + b.generator_power) / 2000 * hours;
    bucket.latest = tb;
  }
  const off = totals.off, gen = totals.generator;
  const discharge = -off.soc / off.hours;
  const charge = gen.soc / gen.hours;
  if (off.hours < 0.75 || gen.hours < 0.5 ||
      !(discharge > 0.5 && discharge <= 30) ||
      !(charge > 0.5 && charge <= 30) ||
      now - off.latest > 18 * HOUR || now - gen.latest > 36 * HOUR) return null;
  return { discharge, charge, generatorKw: gen.kwh / gen.hours,
    offHours: off.hours, generatorHours: gen.hours,
    offLatest: off.latest, generatorLatest: gen.latest };
}

export function fuelPlan({ now, targetTime, minSoc, maxSoc, currentSoc, rows,
  litersPerKwh, fuelInTank }) {
  const target = nextTargetTime(now, targetTime);
  if (!target || !Number.isFinite(currentSoc) || currentSoc < 0 || currentSoc > 100 ||
      !Number.isFinite(minSoc) || !Number.isFinite(maxSoc) ||
      minSoc < 15 || maxSoc > 100 || minSoc > maxSoc ||
      !(litersPerKwh > 0)) return { reason: "Enter a valid target and wait for live battery data." };
  const rates = recentRates(rows, now);
  if (!rates) return { reason: "Not enough recent, low-solar discharge and accepted-generator charging data for a safe estimate." };
  const horizon = (target.getTime() - now) / HOUR;
  const hoursFor = (soc) => (soc - currentSoc + rates.discharge * horizon) /
    (rates.charge + rates.discharge);
  const lowHours = Math.max(0, hoursFor(minSoc));
  const highHours = Math.max(0, hoursFor(maxSoc));
  if (lowHours > horizon) return { reason: "Target is not reachable by this time at the recent charge rate.", rates };
  const boundedHigh = Math.min(highHours, horizon);
  const litersLow = lowHours * rates.generatorKw * litersPerKwh;
  const litersHigh = boundedHigh * rates.generatorKw * litersPerKwh;
  const reserveLiters = litersHigh * 1.25;
  const knownTank = fuelInTank !== "" && fuelInTank != null &&
    Number.isFinite(Number(fuelInTank)) && Number(fuelInTank) >= 0;
  const belowCriticalIn = rates.discharge > 0 ? (currentSoc - 15) / rates.discharge : null;
  return { target, horizon, rates, lowHours, highHours: boundedHigh,
    litersLow, litersHigh, reserveLiters,
    addLiters: knownTank ? Math.max(0, reserveLiters - Number(fuelInTank)) : null,
    belowCriticalIn: belowCriticalIn != null && belowCriticalIn < horizon ? belowCriticalIn : null,
    canReachUpper: highHours <= horizon };
}
