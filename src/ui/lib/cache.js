// Local read cache so a relaunch (even offline) shows the last conversation,
// plus per-thread scroll position memory.
//
// Entries carry a schemaVersion: anything not matching the current shape is
// ignored (and lazily purged) instead of being rendered as if current.

const MSG_PREFIX = "codexPhoneCache:";
const SCROLL_PREFIX = "codexPhoneScroll:";
const MAX_MESSAGES = 60;
const MAX_OUTPUT = 4000;
const CACHE_SCHEMA_VERSION = 2;

function slimMessages(messages) {
  return (messages || []).slice(-MAX_MESSAGES).map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "tool" ? { ...part, output: String(part.output || "").slice(0, MAX_OUTPUT) } : part,
    ),
  }));
}

export function saveCachedMessages(threadId, messages, { truncated = true, savedAt = Date.now() } = {}) {
  if (!threadId || !messages?.length) return;
  try {
    localStorage.setItem(
      MSG_PREFIX + threadId,
      JSON.stringify({
        schemaVersion: CACHE_SCHEMA_VERSION,
        threadId,
        savedAt,
        // The cache keeps the recent tail only; readers must surface this.
        truncated: Boolean(truncated),
        messages: slimMessages(messages),
      }),
    );
  } catch {
    /* quota — ignore */
  }
}

export function loadCachedMessages(threadId) {
  if (!threadId) return null;
  try {
    const raw = localStorage.getItem(MSG_PREFIX + threadId);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // Legacy (schemaVersion<2) or broken entries are not renderable state.
    if (!entry || entry.schemaVersion !== CACHE_SCHEMA_VERSION) {
      localStorage.removeItem(MSG_PREFIX + threadId);
      return null;
    }
    return { ...entry, stale: Date.now() - entry.savedAt > 10 * 60_000 || entry.truncated };
  } catch {
    return null;
  }
}

export function saveScroll(threadId, top) {
  if (!threadId) return;
  try {
    localStorage.setItem(SCROLL_PREFIX + threadId, String(Math.round(top)));
  } catch {
    /* ignore */
  }
}

export function loadScroll(threadId) {
  if (!threadId) return null;
  try {
    const value = localStorage.getItem(SCROLL_PREFIX + threadId);
    return value == null ? null : Number(value);
  } catch {
    return null;
  }
}
