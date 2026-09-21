import { useEffect, useState } from "react";

const KEY = "helio-power-unit";

export function getPowerUnit() {
  return localStorage.getItem(KEY) === "W" ? "W" : "kW";
}

export function setPowerUnit(unit) {
  if (unit === "W") {
    localStorage.setItem(KEY, "W");
  } else {
    localStorage.removeItem(KEY);
  }
  window.dispatchEvent(
    new CustomEvent("power-unit-change", { detail: getPowerUnit() }),
  );
}

const localNumber = (value, decimals) =>
  value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });

export function formatPower(watts, unit = getPowerUnit(), kWDecimals = 2) {
  if (typeof watts !== "number" || !Number.isFinite(watts)) return "—";
  return unit === "W"
    ? localNumber(Math.abs(watts), 0)
    : localNumber(Math.abs(watts) / 1000, kWDecimals);
}

export function usePowerUnit() {
  const [unit, setUnit] = useState(getPowerUnit);
  useEffect(() => {
    const onChange = (event) => setUnit(event.detail || getPowerUnit());
    window.addEventListener("power-unit-change", onChange);
    return () => window.removeEventListener("power-unit-change", onChange);
  }, []);
  return unit;
}
