// API + auth helpers for the phone bridge (v2 client).
//
// Auth model: the bridge token is exchanged once for an HttpOnly session cookie
// via POST /api/auth. Afterwards requests are cookie-authenticated and the token
// is stripped from the address bar, so it cannot leak through screenshots,
// history or shared links. The raw token stays in memory only for the very
// first handshake and as a fallback if cookie auth is unavailable.

const params = new URLSearchParams(location.search);

export const initialThread =
  params.get("thread") || (typeof localStorage !== "undefined" ? localStorage.getItem("codexPhoneThread") : "") || "";
export const tokenRequired = true;

// Token from the URL wins, then a remembered token (older clients / native shell).
let bridgeToken = params.get("token") || "";
if (!bridgeToken) {
  try {
    bridgeToken = localStorage.getItem("codexPhoneToken") || "";
  } catch {
    bridgeToken = "";
  }
}

let cookieReady = false;

export function getToken() {
  return bridgeToken;
}

// Remove ?token= … from the visible URL without reloading, so the credential no
// longer appears in the omnibox, screenshots or the history entry.
function stripTokenFromUrl() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      const next = `${url.pathname}${url.search}${url.hash}`;
      history.replaceState(history.state, "", next);
    }
  } catch {
    /* ignore */
  }
}

function parseSameOrigin(value) {
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin) return null;
    return url;
  } catch {
    return null;
  }
}

// For fetch(): same-origin path+search. When cookie auth is not yet active the
// token is attached as a query param (bootstrap only).
export function withToken(url) {
  const target = parseSameOrigin(url);
  if (!target) return url;
  if (!cookieReady && bridgeToken) target.searchParams.set("token", bridgeToken);
  return target.pathname + target.search;
}

// Absolute same-origin URL with token, for <img>/assets. Returns "" for
// anything not same-origin, so a credentialed cross-origin URL is never
// produced. Falls back to token query only during bootstrap.
export function authedUrl(value) {
  const target = parseSameOrigin(value);
  if (!target) return "";
  if (!cookieReady && bridgeToken) target.searchParams.set("token", bridgeToken);
  return target.href;
}

// Exchange the bridge token for a session cookie. Idempotent; safe to retry.
export async function authenticate() {
  if (!bridgeToken) {
    // No token present: still probe /api/info so tokenless debug mode works.
    try {
      const probe = await fetch("/api/info", { credentials: "same-origin", cache: "no-store" });
      if (probe.ok) {
        const info = await probe.json().catch(() => ({}));
        if (info && info.tokenRequired === false) cookieReady = true;
      }
    } catch {
      /* offline: the first real request will surface the error */
    }
    stripTokenFromUrl();
    return cookieReady;
  }
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Codex-Client": "1" },
      body: JSON.stringify({ token: bridgeToken }),
    });
    if (response.ok) {
      cookieReady = true;
      try {
        localStorage.setItem("codexPhoneToken", bridgeToken);
      } catch {
        /* ignore */
      }
      stripTokenFromUrl();
      return true;
    }
  } catch {
    /* fall through: keep token fallback so the app still works offline */
  }
  stripTokenFromUrl();
  return false;
}

export function isCookieReady() {
  return cookieReady;
}

export async function apiGet(path, { signal } = {}) {
  // Callers cancel via AbortSignal; the token is never attached to foreign
  // origins and stale responses are discarded by the request-generation layer.
  const response = await fetch(withToken(path), { credentials: "same-origin", cache: "no-store", signal });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = data?.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

export function isAbortError(error) {
  return Boolean(error) && (error.name === "AbortError" || error.code === 20);
}

// Unify the file-preview shape so the UI never has to know about backend field
// renames (e.g. the image response used to expose `imageUrl` only). Returns a
// canonical `{ path, kind, url, text, size, truncated }`.
export function normalizeFilePreview(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const url = raw.url || raw.imageUrl || "";
  return {
    ...raw,
    url,
    kind: raw.kind || (url ? "image" : "text"),
    truncated: Boolean(raw.truncated),
    size: typeof raw.size === "number" ? raw.size : null,
  };
}

export const api = {
  auth: () => authenticate(),
  info: (opts) => apiGet("/api/info", opts),
  status: (refreshRateLimits = false, opts) => apiGet(`/api/status${refreshRateLimits ? "?refreshRateLimits=1" : ""}`, opts),
  threads: (provider, opts) => apiGet(`/api/threads?provider=${encodeURIComponent(provider)}`, opts),
  thread: (threadId, provider, sinceRev, opts) =>
    apiGet(
      `/api/thread?thread=${encodeURIComponent(threadId)}&provider=${encodeURIComponent(provider)}` +
        (sinceRev ? `&sinceRev=${encodeURIComponent(sinceRev)}` : ""),
      opts,
    ),
  skills: (opts) => apiGet("/api/skills", opts),
  plugins: (opts) => apiGet("/api/plugins", opts),
  automations: (opts) => apiGet("/api/automations", opts),
  config: (opts) => apiGet("/api/config", opts),
  models: (opts) => apiGet("/api/models", opts),
  review: (opts) => apiGet("/api/review", opts),
  workspace: (limit = 180, opts) => apiGet(`/api/workspace?limit=${limit}`, opts),
  artifacts: (opts) => apiGet("/api/artifacts", opts),
  file: (path, opts) => apiGet(`/api/file?path=${encodeURIComponent(path)}`, opts).then(normalizeFilePreview),
};
