// Theme preference (system|light|dark), applied to <html data-theme> + the
// Android status/nav bars (via the CodexNative bridge when present).

const KEY = "codexPhoneTheme";
const META_COLOR = { dark: "#0e1116", light: "#fbfaff" };

export function normalizePref(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function loadPref() {
  try {
    return normalizePref(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}

export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function syncNative(theme) {
  try {
    // Provided by the Android shell (MainActivity JavascriptInterface).
    if (window.CodexNative && typeof window.CodexNative.setTheme === "function") {
      window.CodexNative.setTheme(theme);
    }
  } catch {
    /* ignore */
  }
}

export function applyTheme(pref) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePref = pref;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", META_COLOR[theme]);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  syncNative(theme);
  return theme;
}

export function watchSystemTheme(onChange) {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (loadPref() === "system") onChange(applyTheme("system"));
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
