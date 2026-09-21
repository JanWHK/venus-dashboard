import React, { useEffect, useState } from "react";
import { api } from "../api";
import { savedPreference, setPreference } from "../theme";
import Icon from "./Icon";

const intervals = [
  [0, "Live only", "No new historical readings"],
  [300, "Every 5 minutes", "288 summaries per day"],
  [600, "Every 10 minutes", "144 summaries per day"],
  [900, "Every 15 minutes", "96 summaries per day"],
  [1800, "Every 30 minutes", "48 summaries per day"],
  [3600, "Every hour", "24 summaries per day"],
];

const themes = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function PeoplePanel({ user }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/auth/users")
      .then((data) => setUsers(data))
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function run(action, done) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      done?.();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const create = (event) => {
    event.preventDefault();
    run(
      () =>
        api("/auth/users", {
          method: "POST",
          body: JSON.stringify(form),
        }),
      () => {
        setNotice(`${form.username.trim()} can now sign in.`);
        setForm({ username: "", password: "", role: "viewer" });
      },
    );
  };
  const remove = (account) =>
    run(
      () => api(`/auth/users/${account.id}`, { method: "DELETE" }),
      () => setNotice(`${account.username} was removed.`),
    );
  const reset = (account) => {
    const next = prompt(
      `New password for ${account.username} (at least 12 characters):`,
    );
    if (next == null) return;
    run(
      () =>
        api(`/auth/users/${account.id}/password`, {
          method: "PUT",
          body: JSON.stringify({ new_password: next }),
        }),
      () => setNotice(`Password updated for ${account.username}.`),
    );
  };

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">WHO SEES THIS</span>
          <h2>People.</h2>
        </div>
        <Icon name="devices" />
      </div>
      <p className="settings-description">
        Invite household members to follow the sun. Viewers can read every
        dashboard; only you can change settings or manage people.
      </p>
      <ul className="people-list">
        {(users || []).map((account) => (
          <li key={account.id}>
            <span className="avatar avatar-inline">
              {account.username[0].toUpperCase()}
            </span>
            <div className="people-name">
              <strong>{account.username}</strong>
              <small>
                {account.id === user.id
                  ? "you"
                  : account.role === "admin"
                    ? "admin"
                    : "viewer"}
              </small>
            </div>
            {account.id !== 1 && account.id !== user.id && (
              <span className="people-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => reset(account)}
                >
                  Reset password
                </button>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => remove(account)}
                >
                  Remove
                </button>
              </span>
            )}
          </li>
        ))}
        {!users && <li className="people-name">Loading…</li>}
      </ul>
      <form className="people-form" onSubmit={create}>
        <input
          type="text"
          required
          placeholder="Username"
          aria-label="New username"
          maxLength={80}
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          type="password"
          required
          minLength={12}
          placeholder="Password (12+ characters)"
          aria-label="Password for the new user"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <select
          aria-label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary-button" disabled={busy}>
          Add person <Icon name="arrow" size={15} />
        </button>
      </form>
      {notice && (
        <p role="status" className="saved-note">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function MyPasswordPanel({ user }) {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/auth/me/password", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm({ current_password: "", new_password: "" });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">JUST YOU</span>
          <h2>Your password.</h2>
        </div>
        <Icon name="shield" />
      </div>
      <form className="password-form" onSubmit={save}>
        <label>
          <span>Current password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={form.current_password}
            onChange={(e) =>
              setForm({ ...form, current_password: e.target.value })
            }
          />
        </label>
        <label>
          <span>New password (12+ characters)</span>
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={form.new_password}
            onChange={(e) => setForm({ ...form, new_password: e.target.value })}
          />
        </label>
        <div className="settings-actions">
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
            <Icon name="check" size={17} />
          </button>
          {saved && <span role="status">Password updated.</span>}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

export default function Settings({ demo, user }) {
  const [settings, setSettings] = useState(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = demo || user?.role === "admin";
  const [theme, setThemeState] = useState(() => savedPreference());
  useEffect(() => {
    let active = true;
    if (demo) {
      setSettings({
        interval_seconds: 0,
        host: "Demo installation",
        portal_id: "demo",
        port: 8883,
        transport: "tcp",
      });
      return;
    }
    api("/settings")
      .then((data) => {
        if (active) {
          setSettings(data);
          setSelected(data.interval_seconds);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (!demo)
        await api("/settings", {
          method: "PUT",
          body: JSON.stringify({ interval_seconds: selected }),
        });
      setSettings((prev) => ({ ...prev, interval_seconds: selected }));
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function changeTheme(next) {
    setThemeState(next);
    setPreference(next);
  }
  return (
    <div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LESS NOISE. MORE CONTROL.</span>
          <h1>Make it yours.</h1>
          <p>Keep the live detail. Save only the history you need.</p>
        </div>
      </div>
      <div className="settings-grid">
        <div>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">A LIGHTER FOOTPRINT</span>
                <h2>How much should we remember?</h2>
              </div>
              <Icon name="leaf" />
            </div>
            <p className="settings-description">
              Live readings refresh every 2 seconds, whatever you choose here.
              Optional history saves solar, home, grid, generator and battery
              power plus battery charge.
            </p>
            <fieldset disabled={!settings || busy || !isAdmin}>
              <legend className="sr-only">Recording interval</legend>
              {intervals.map(([value, title, subtitle]) => (
                <label
                  className={`interval-option ${selected === value ? "chosen" : ""}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="interval"
                    value={value}
                    checked={selected === value}
                    onChange={() => {
                      setSelected(value);
                      setSaved(false);
                    }}
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>{subtitle}</small>
                  </span>
                  {value === 900 && <span className="recommended">DEFAULT</span>}
                </label>
              ))}
            </fieldset>
            {!isAdmin && (
              <p className="settings-description">
                Recording preferences are managed by the workspace owner.
              </p>
            )}
            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={
                  !settings ||
                  busy ||
                  !isAdmin ||
                  selected === settings.interval_seconds
                }
                onClick={save}
              >
                {busy ? "Saving…" : "Save preferences"}
                <Icon name="check" size={17} />
              </button>
              {saved && (
                <span role="status">
                  {demo
                    ? "Preview updated. Nothing saved."
                    : "Preferences saved."}
                </span>
              )}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">EASY ON THE EYES</span>
                <h2>Appearance.</h2>
              </div>
              <Icon name="eye" />
            </div>
            <div className="segmented theme-segmented" role="group" aria-label="Theme">
              {themes.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={theme === value}
                  className={theme === value ? "selected" : ""}
                  onClick={() => changeTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="settings-description">
              System follows your device’s light or dark preference. Your choice
              stays on this device.
            </p>
          </section>
        </div>
        <div>
          {isAdmin && !demo && <PeoplePanel user={user} />}
          {!demo && <MyPasswordPanel user={user} />}
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">YOUR CONNECTION</span>
                <h2>GX gateway.</h2>
              </div>
              <Icon name="wifi" />
            </div>
            {[
              ["Address", settings?.host],
              ["Portal ID", settings?.portal_id],
              ["Transport", settings?.transport],
              ["Port", settings?.port],
            ].map(([label, value]) => (
              <div className="system-row" key={label}>
                <span>{label}</span>
                <strong>{value ?? "—"}</strong>
              </div>
            ))}
            <p className="settings-description">
              Connection details are managed on the server. Your GX must allow
              MQTT on the configured transport and port.
            </p>
          </section>
          <section className="privacy-card">
            <Icon name="shield" size={26} />
            <h3>Your data, closer to home.</h3>
            <p>
              Detailed device readings stay in memory. The live chart holds 15
              minutes. Restarting clears that live buffer; saved summaries
              remain.
            </p>
            <p>
              Existing recordings are preserved. This dashboard does not delete
              your old data.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
