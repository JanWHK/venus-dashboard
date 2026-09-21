// Light/dark theming. The resolved theme lands on <html data-theme="…"> so
// CSS can swap tokens, and a `theme-change` event keeps React charts in step.
const KEY = "helio-theme";

export function resolveTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function savedPreference() {
  return localStorage.getItem(KEY) || "system";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent("theme-change", { detail: theme }));
}

export function setPreference(preference) {
  if (preference === "light" || preference === "dark") {
    localStorage.setItem(KEY, preference);
  } else {
    localStorage.removeItem(KEY);
  }
  applyTheme(resolveTheme());
}

export function initTheme() {
  applyTheme(resolveTheme());
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!localStorage.getItem(KEY)) applyTheme(resolveTheme());
    });
}
