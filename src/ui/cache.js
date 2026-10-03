// Local read cache so a relaunch (even offline) shows the last conversation,
// plus per-thread scroll position memory.

const MSG_PREFIX = "codexPhoneCache:";
const SCROLL_PREFIX = "codexPhoneScroll:";
const MAX_MESSAGES = 60;
const MAX_OUTPUT = 4000;

function slimMessages(messages) {
  return (messages || []).slice(-MAX_MESSAGES).map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "tool" ? { ...part, output: String(part.output || "").slice(0, MAX_OUTPUT) } : part,
    ),
  }));
}

export function saveCachedMessages(threadId, messages) {
  if (!threadId || !messages?.length) return;
  try {
    localStorage.setItem(MSG_PREFIX + threadId, JSON.stringify(slimMessages(messages)));
  } catch {
    /* quota — ignore */
  }
}

export function loadCachedMessages(threadId) {
  if (!threadId) return null;
  try {
    const raw = localStorage.getItem(MSG_PREFIX + threadId);
    return raw ? JSON.parse(raw) : null;
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
