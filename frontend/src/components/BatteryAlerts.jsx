import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "./BatteryAlerts.css";

export default function BatteryAlerts({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState(false);
  const audio = useRef(null);
  const lastSound = useRef({ key: "", at: 0 });
  const current = data?.active?.[0];
  const fresh = !error && data?.soc != null;

  useEffect(() => {
    let stopped = false;
    let timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await api("/alerts", { signal: controller.signal });
        if (!stopped) { setData(next); setError(""); }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);

  useEffect(() => () => { audio.current?.close(); }, []);

  function tone(threshold = 50) {
    const context = audio.current;
    if (!context || context.state !== "running") return;
    const count = threshold === 15 ? 3 : threshold === 25 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.4;
      oscillator.frequency.value = threshold === 15 ? 880 : threshold === 25 ? 660 : 440;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }

  useEffect(() => {
    if (!sound || !fresh || !current || current.acknowledged_at) return;
    const key = `${current.id}:${current.last_notice_at}`;
    const now = Date.now();
    if (lastSound.current.key !== key ||
        (current.threshold === 15 && now - lastSound.current.at >= 60000)) {
      tone(current.threshold);
      lastSound.current = { key, at: now };
    }
  }, [data, sound, fresh, current]);

  async function toggleSound() {
    setActionError("");
    if (sound) { setSound(false); return; }
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error("Audio is not supported in this browser.");
      audio.current ||= new Audio();
      await audio.current.resume();
      if (audio.current.state !== "running") throw new Error("Browser blocked sound. Please try again.");
      tone();
      setSound(true);
    } catch (e) { setActionError(e.message); }
  }

  async function acknowledge() {
    setBusy(true);
    setActionError("");
    try {
      await api(`/alerts/${current.id}/acknowledge`, { method: "POST" });
      setData(await api("/alerts"));
    } catch (e) { setActionError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className={`battery-alerts ${current?.severity || "normal"}`} aria-label="Battery alerts">
      <div className="battery-alert-summary">
        <div role={current && !current.acknowledged_at ? "alert" : "status"}>
          <strong>{current
            ? `${current.severity.toUpperCase()} · ${current.threshold}% battery threshold`
            : "Battery watch · 50% / 25% / 15%"}</strong>
          <p>{error ? `Alert monitoring unavailable: ${error}` : !data ? "Checking alerts…" : !fresh
            ? "No fresh battery reading. Alerts cannot confirm current charge."
            : current ? `${data.soc.toFixed(1)}% now. ${current.action}`
            : `${data.soc.toFixed(1)}% now. No active battery alerts.`}</p>
          {current?.acknowledged_at && <small>Acknowledged. Reminders stopped; monitoring continues.</small>}
        </div>
        <div className="battery-alert-actions">
          <button className="text-button" onClick={toggleSound} aria-pressed={sound}>
            {sound ? "Mute this browser" : "Enable alarm sound"}
          </button>
          {current && !current.acknowledged_at && user?.role === "admin" &&
            <button className="primary-button" disabled={busy} onClick={acknowledge}>Acknowledge alert</button>}
        </div>
      </div>
      {actionError && <p role="alert">{actionError}</p>}
      <details>
        <summary>Delivery status &amp; recent alerts</summary>
        <p>Telegram: {data?.channels.telegram ? "configured" : "not configured"} · Email backup: {data?.channels.email ? "configured" : "not configured"}.</p>
        <p>Alerts need 30 seconds below a threshold. Recovery needs more than 5 percentage points above it.
          Critical messages repeat every 10 minutes until acknowledged or recovered. Email is used if Telegram fails.</p>
        <p>Sound works only while this page is open and the browser permits audio. Critical sound repeats every minute.
          Telegram and email run on the server, even when this page is closed. An owner can acknowledge alerts for everyone.</p>
        {data && (!data.channels.telegram || !data.channels.email) &&
          <p>Notification setup is incomplete. Ask the server administrator to configure Telegram and SMTP using ALERTS.md.</p>}
        <ul>{data?.recent.map(row => <li key={row.id}>
          <strong>{row.severity.toUpperCase()} · {row.soc.toFixed(1)}%</strong>
          <span>{new Date(row.created_at).toLocaleString()} · {row.resolved_at ? "Recovered" : row.acknowledged_at ? "Acknowledged" : "Active"}</span>
          <span>Telegram: {row.telegram.replaceAll("_", " ")} · Email: {row.email.replaceAll("_", " ")} · Delivery: {row.delivery}</span>
        </li>)}</ul>
        {data?.recent.length === 0 && <p>No battery alerts recorded yet.</p>}
      </details>
    </section>
  );
}
