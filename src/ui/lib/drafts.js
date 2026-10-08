// Per provider+thread composer drafts, persisted locally so switching sessions
// (or an accidental reload) never silently loses typed input.
//
// The key intentionally includes the provider and thread id: a draft typed for
// thread A must never appear (or be sent) in thread B. New threads use the
// "new" bucket until the server assigns an authoritative thread id.

const PREFIX = "codexPhoneDraft:";

function keyFor(provider, threadId) {
  return `${PREFIX}${provider || "codex"}:${threadId || "new"}`;
}

export function loadDraft(provider, threadId) {
  try {
    return localStorage.getItem(keyFor(provider, threadId)) || "";
  } catch {
    return "";
  }
}

export function saveDraft(provider, threadId, text) {
  try {
    const key = keyFor(provider, threadId);
    if (text && text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    /* quota / disabled storage: drafts are best-effort, never block typing */
  }
}

export function clearDraft(provider, threadId) {
  saveDraft(provider, threadId, "");
}
