import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import Login from "./components/Login";
import Icon, { Brand } from "./components/Icon";
import BatteryAlerts from "./components/BatteryAlerts";

const Dashboard = lazy(() => import("./components/Dashboard"));
const Devices = lazy(() => import("./components/Devices"));
const Settings = lazy(() => import("./components/Settings"));
const Reports = lazy(() => import("./components/Reports"));

function Workspace() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    api("/auth/me")
      .then((data) => {
        if (active) setUser(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    const expired = () => {
      setUser(null);
      navigate("/login");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("session-expired", expired);
    };
  }, [navigate]);
  const enter = (data) => {
    setUser(data);
    setDemo(false);
    navigate("/");
  };
  const enterDemo = () => {
    setDemo(true);
    navigate("/");
  };
  async function logout() {
    try {
      if (!demo) await api("/auth/logout", { method: "POST" });
      setUser(null);
      setDemo(false);
      setLogoutError("");
      navigate("/login");
    } catch (e) {
      setLogoutError(e.message);
    }
  }
  if (checking)
    return (
      <div className="app-loading">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user && !demo) return <Login onLogin={enter} onDemo={enterDemo} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">YOUR ENERGY SPACE</div>
        <nav aria-label="Main navigation">
          {[
            ["/", "overview", "Overview"],
            ["/devices", "devices", "Devices"],
            ["/history", "history", "Energy history"],
            ["/reports", "reports", "Reports"],
            ["/settings", "settings", "Settings"],
          ].map(([to, icon, label]) => (
            <NavLink key={to} to={to} end>
              <Icon name={icon} />
              <span>{label}</span>
              {to === "/" && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="leaf" size={26} />
            <strong>
              A little more awareness.
              <br />A little less footprint.
            </strong>
            <span>Make the most of your energy.</span>
          </div>
          <div className="profile">
            <span className="avatar">
              {demo ? "D" : user.username[0].toUpperCase()}
            </span>
            <div>
              <strong>{demo ? "Demo workspace" : user.username}</strong>
              <small>
                {demo
                  ? "Sample installation"
                  : user.role === "admin"
                    ? "Workspace owner"
                    : "Viewer"}
              </small>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              aria-label={demo ? "Exit demo" : "Sign out"}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
          {logoutError && (
            <p role="alert" className="form-error">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div className="main-shell">
        {demo && (
          <div className="demo-banner">
            <span>
              <strong>Demo workspace</strong> · Illustrative data, not your GX
              readings.
            </span>
            <button onClick={logout}>
              Exit demo <Icon name="arrow" size={14} />
            </button>
          </div>
        )}
        <header className="topbar">
          <span>
            <span className="breadcrumb">Workspace</span>
            <span className="slash">/</span> My energy
          </span>
          <div className="topbar-right">
            <span className="local-badge">
              <Icon name="shield" size={14} /> Private workspace
            </span>
            <span className="topbar-date">
              {new Date().toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-button mobile-logout"
              onClick={logout}
              aria-label={demo ? "Exit demo" : "Sign out"}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>
        <main>
          {!demo && <BatteryAlerts user={user} />}
          <Suspense
            fallback={
              <div className="empty-state">Opening your energy view…</div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard demo={demo} />} />
              <Route
                path="/history"
                element={<Dashboard demo={demo} historyOnly />}
              />
              <Route path="/devices" element={<Devices demo={demo} />} />
              <Route
                path="/settings"
                element={<Settings demo={demo} user={user} />}
              />
              <Route path="/reports" element={<Reports demo={demo} user={user} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="workspace-footer">
          <span>
            <span className="tiny-brand">helio.</span> A clearer view of your
            energy.
          </span>
          <span>Made for your Victron system</span>
        </footer>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Workspace />
    </BrowserRouter>
  );
}
