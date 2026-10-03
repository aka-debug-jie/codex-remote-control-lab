// API + token helpers for the phone bridge (v2 client).

const params = new URLSearchParams(location.search);

export const token = params.get("token") || localStorage.getItem("codexPhoneToken") || "";
export const initialThread =
  params.get("thread") || (typeof localStorage !== "undefined" ? localStorage.getItem("codexPhoneThread") : "") || "";
export const tokenRequired = true;

if (token) {
  try {
    localStorage.setItem("codexPhoneToken", token);
  } catch {
    /* ignore */
  }
}

export function withToken(url) {
  const target = new URL(url, location.href);
  if (token) target.searchParams.set("token", token);
  return target.pathname + target.search;
}

export async function apiGet(path) {
  const response = await fetch(withToken(path), { credentials: "same-origin", cache: "no-store" });
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

export const api = {
  info: () => apiGet("/api/info"),
  status: (refreshRateLimits = false) => apiGet(`/api/status${refreshRateLimits ? "?refreshRateLimits=1" : ""}`),
  threads: (provider) => apiGet(`/api/threads?provider=${encodeURIComponent(provider)}`),
  thread: (threadId, provider, sinceRev) =>
    apiGet(
      `/api/thread?thread=${encodeURIComponent(threadId)}&provider=${encodeURIComponent(provider)}` +
        (sinceRev ? `&sinceRev=${encodeURIComponent(sinceRev)}` : ""),
    ),
  skills: () => apiGet("/api/skills"),
  plugins: () => apiGet("/api/plugins"),
  automations: () => apiGet("/api/automations"),
  config: () => apiGet("/api/config"),
  models: () => apiGet("/api/models"),
  review: () => apiGet("/api/review"),
  workspace: (limit = 180) => apiGet(`/api/workspace?limit=${limit}`),
  artifacts: () => apiGet("/api/artifacts"),
  file: (path) => apiGet(`/api/file?path=${encodeURIComponent(path)}`),
};
