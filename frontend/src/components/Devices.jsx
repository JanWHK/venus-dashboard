import React, { useState } from "react";
import Icon from "./Icon";
import { number, useTelemetry } from "./Dashboard";

export default function Devices({ demo }) {
  const { data, error } = useTelemetry(demo, "/devices");
  const [query, setQuery] = useState("");
  const devices = (data?.devices || [])
    .map((device) => ({
      ...device,
      metrics: device.metrics.filter((metric) =>
        `${device.name} ${device.id} ${metric.path}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    }))
    .filter((device) => device.metrics.length);
  return (
    <div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY PART OF YOUR ENERGY</span>
          <h1>Meet your system.</h1>
          <p>
            Explore available GX readings. Live in memory, without detailed
            database logging.
          </p>
        </div>
      </div>
      <label className="device-search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search devices or readings…"
          aria-label="Search devices or readings"
        />
        <span>{devices.length} devices</span>
      </label>
      {error && (
        <div role="alert" className="connection-notice">
          {error}
        </div>
      )}
      {!devices.length && (
        <div className="panel empty-state device-empty">
          <Icon name="devices" size={34} />
          <h2>
            {query
              ? "No matching readings."
              : "Your devices will feel right at home."}
          </h2>
          <p>
            {query
              ? "Try another device name or metric."
              : "Devices appear automatically when the GX publishes MQTT telemetry."}
          </p>
        </div>
      )}
      <div className="devices-grid">
        {devices.map((device) => (
          <section className="panel device-panel" key={device.id}>
            <div className="panel-heading">
              <div className="device-title">
                <span className="device-icon">
                  <Icon
                    name={
                      device.service === "battery"
                        ? "battery"
                        : device.service === "solarcharger"
                          ? "sun"
                          : "devices"
                    }
                  />
                </span>
                <div>
                  <h2>{device.name}</h2>
                  <span className="device-id">{device.id}</span>
                </div>
              </div>
              <span className="device-count">
                {device.metrics.length} readings
              </span>
            </div>
            <div className="device-readings">
              {device.metrics.map((metric) => (
                <div
                  className={`device-reading ${metric.stale ? "stale-reading" : ""}`}
                  key={metric.path}
                >
                  <span>{metric.path}</span>
                  <strong>
                    {metric.value == null
                      ? "—"
                      : typeof metric.value === "number"
                        ? number(
                            metric.value,
                            Number.isInteger(metric.value) ? 0 : 2,
                          )
                        : String(metric.value)}
                    {metric.stale && <small>Stale</small>}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
