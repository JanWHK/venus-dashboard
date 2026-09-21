import React, { useEffect, useState } from "react";
import { api } from "../api";
import Icon, { Brand } from "./Icon";

export default function Login({ onLogin, onDemo }) {
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    api("/auth/status")
      .then((data) => {
        if (active) {
          setSetup(data.setup_required);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError("Workspace is unavailable. You can still explore the demo.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(event.target));
    try {
      onLogin(
        await api(setup ? "/auth/setup" : "/auth/login", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-art">
        <Brand />
        <div className="login-story">
          <span className="eyebrow">A LITTLE CLOSER TO YOUR ENERGY</span>
          <h1>
            Good energy.
            <br />
            Beautifully clear.
          </h1>
          <p>
            Your sun. Your home. Your energy, in balance.
            <br />
            Meet a calmer way to see what powers your day.
          </p>
        </div>
        <div className="solar-landscape" aria-hidden="true">
          <div className="landscape-sun" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <svg viewBox="0 0 700 360">
            <defs>
              <pattern
                id="panel-grid"
                width="38"
                height="30"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M38 0H0V30"
                  fill="none"
                  stroke="#a8c6b4"
                  strokeWidth=".8"
                />
              </pattern>
            </defs>
            <path d="M0 230Q170 140 355 243T700 240V360H0Z" fill="#234d42" />
            <path d="M0 300Q200 220 450 280T700 260V360H0Z" fill="#315e4d" />
            <g transform="translate(135 145) skewX(-20)">
              <rect
                width="320"
                height="152"
                rx="5"
                fill="#183e36"
                stroke="#b3cdb9"
                strokeWidth="2"
              />
              <rect
                x="5"
                y="5"
                width="310"
                height="142"
                fill="url(#panel-grid)"
              />
              <path d="M70 153v45m180-45v45" stroke="#abc5b3" strokeWidth="5" />
            </g>
          </svg>
          <div className="landscape-label">
            <span className="pulse-dot" /> Connected to a brighter everyday
          </div>
        </div>
        <div className="login-art-footer">
          <span>BUILT AROUND YOUR VICTRON SYSTEM</span>
          <span>Live. Local. Yours.</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-top">
          <span>Your private energy workspace</span>
          <Icon name="shield" />
        </div>
        <div className="login-form-wrap">
          <div className="form-symbol">
            <Icon name="sun" size={30} />
          </div>
          <span className="eyebrow">WELCOME TO HELIO</span>
          <h2>{setup ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {setup
              ? "Create your private account to get started."
              : "Sign in to see your energy at work."}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <label>
                Setup key
                <input
                  name="setup_key"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="Key from your server administrator"
                />
                <small>
                  Find the first-use key in the backend startup log.
                </small>
              </label>
            )}
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                placeholder="Your username"
                required
                maxLength={80}
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={setup ? "new-password" : "current-password"}
                  placeholder={
                    setup ? "At least 12 characters" : "Enter your password"
                  }
                  minLength={setup ? 12 : 1}
                  maxLength={256}
                  required
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name="eye" />
                </button>
              </div>
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              className="primary-button login-submit"
              disabled={busy || !ready}
            >
              {busy
                ? "One moment…"
                : setup
                  ? "Create my workspace"
                  : "Sign in to your workspace"}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="login-divider">
            <span>TAKE A LOOK AROUND</span>
          </div>
          <button className="demo-button" onClick={onDemo}>
            Explore the demo <Icon name="arrow" size={17} />
          </button>
          <p className="demo-footnote">
            Sample energy data. No account needed.
          </p>
        </div>
        <footer className="login-footer">
          <Icon name="shield" size={15} /> A private connection to your energy.
        </footer>
      </section>
    </div>
  );
}
