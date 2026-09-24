import test from "node:test";
import assert from "node:assert/strict";
import { fuelPlan, nextTargetTime, recentRates } from "./fuelPlanner.js";

const hour = 3_600_000;
const now = new Date("2026-09-24T21:00:00Z").getTime();
const sample = (hoursAgo, soc, generator = 0, solar = 0, ac = 0) => ({
  recorded_at: new Date(now - hoursAgo * hour).toISOString(),
  battery_soc: soc, generator_power: generator, solar_power: solar,
  ac_in_power: ac,
});
const rows = [
  sample(5, 20, 3200, 0, 3200), sample(4.5, 25, 3200, 0, 3200),
  sample(4, 30, 3200, 0, 3200), sample(2, 44),
  sample(1.5, 39), sample(1, 34), sample(0.5, 29), sample(0, 24),
];

test("next local target time rolls over to tomorrow", () => {
  const start = new Date(2026, 8, 24, 22, 0);
  const target = nextTargetTime(start.getTime(), "07:00");
  assert.equal(target.getDate(), 25);
  assert.equal(target.getHours(), 7);
  assert.equal(nextTargetTime(start.getTime(), "bad"), null);
});

test("night planner uses accepted generator and dark discharge segments", () => {
  const rates = recentRates(rows, now);
  assert.equal(rates.discharge, 10);
  assert.equal(rates.charge, 10);
  assert.equal(rates.generatorKw, 3.2);
  const plan = fuelPlan({ now, targetTime: "07:00", minSoc: 25, maxSoc: 30,
    currentSoc: 24, rows, litersPerKwh: 11 / 17.1056, fuelInTank: "2" });
  assert.ok(plan.lowHours > 0 && plan.highHours > plan.lowHours);
  assert.ok(plan.addLiters > 0);
  assert.ok(Math.abs(plan.addLiters - (plan.litersHigh * 1.25 - 2)) < 1e-9);
  assert.ok(plan.belowCriticalIn < 1);
});

test("unaccepted generator, solar and stale history never produce fuel advice", () => {
  const rejected = rows.map((row) => ({ ...row, ac_in_power: 0 }));
  assert.equal(recentRates(rejected, now), null);
  const sunny = rows.map((row) => ({ ...row, solar_power: 500 }));
  assert.equal(recentRates(sunny, now), null);
  assert.equal(recentRates(rows, now + 40 * hour), null);
  const result = fuelPlan({ now, targetTime: "07:00", minSoc: 25, maxSoc: 30,
    currentSoc: 24, rows: rejected, litersPerKwh: 11 / 17.1056, fuelInTank: "" });
  assert.ok(result.reason);
});

test("unknown tank fuel is not treated as zero", () => {
  const plan = fuelPlan({ now, targetTime: "07:00", minSoc: 25, maxSoc: 30,
    currentSoc: 24, rows, litersPerKwh: 11 / 17.1056, fuelInTank: "" });
  assert.equal(plan.addLiters, null);
});
