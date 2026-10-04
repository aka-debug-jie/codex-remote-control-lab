import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { MessageRow, messageText } from "./MessageRow.jsx";
import { useStoreSelector } from "./store.jsx";
import { saveCachedMessages, saveScroll, loadScroll } from "../lib/cache.js";

const WINDOW_SIZE = 120;
const EXPAND_STEP = 120;

function StatusGroup({ notices }) {
  const [open, setOpen] = useState(false);
  if (!notices.length) return null;
  return (
    <article className="entry status status-group">
      <div className="entry-body">
        <details className="status-details" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            <span className="status-summary-text">工作日志</span>
            <span className="status-count">{notices.length} 条</span>
          </summary>
          <ul className="status-list">
            {notices.map((n) => (
              <li key={n.id} className={n.kind === "error" ? "status-error" : ""}>
                {n.text}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}

export function MessageList({ onLongPress, searchQuery, onCount, onScrollToggle }) {
  const messages = useStoreSelector((s) => s.messages);
  const notices = useStoreSelector((s) => s.notices);
  const threadId = useStoreSelector((s) => s.meta.threadId);
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const restoredRef = useRef(null);
  const scrollSaveRef = useRef(null);
  const [showFab, setShowFab] = useState(false);
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);

  const needle = searchQuery.trim().toLowerCase();
  const filtered = needle ? messages.filter((m) => messageText(m).toLowerCase().includes(needle)) : messages;
  const searched = Boolean(needle);

  const windowed = searched
    ? filtered
    : filtered.length > visibleCount
      ? filtered.slice(filtered.length - visibleCount)
      : filtered;
  const hiddenCount = searched ? 0 : Math.max(0, filtered.length - windowed.length);

  const saveScrollDebounced = useCallback(
    (top) => {
      if (scrollSaveRef.current) clearTimeout(scrollSaveRef.current);
      scrollSaveRef.current = setTimeout(() => saveScroll(threadId, top), 300);
    },
    [threadId],
  );

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 72;
    pinnedRef.current = near;
    setShowFab(distance > 160);
    saveScrollDebounced(el.scrollTop);
    // Reaching the top expands the window to reveal older messages.
    if (el.scrollTop < 24 && hiddenCountRef.current > 0) {
      setVisibleCount((c) => c + EXPAND_STEP);
    }
  }, [saveScrollDebounced]);

  const hiddenCountRef = useRef(hiddenCount);
  hiddenCountRef.current = hiddenCount;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!messages.length) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (restoredRef.current === threadId) return;
    const saved = loadScroll(threadId);
    if (saved != null && Number.isFinite(saved)) {
      el.scrollTop = Math.max(0, saved);
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    } else {
      el.scrollTop = el.scrollHeight;
      pinnedRef.current = true;
    }
    restoredRef.current = threadId;
    setShowFab(false);
  }, [threadId, messages.length]);

  useEffect(() => {
    if (searched) {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    }
  }, [searched, needle]);

  useEffect(() => {
    if (onCount) onCount(searched ? filtered.length : 0);
  }, [onCount, searched, filtered.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollToggle) return undefined;
    const handler = () => onScrollToggle(el.scrollTop > 8);
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScrollToggle]);

  useEffect(() => {
    if (!threadId) return undefined;
    const handle = setTimeout(() => saveCachedMessages(threadId, messages), 800);
    return () => clearTimeout(handle);
  }, [messages, threadId]);

  useEffect(() => {
    setVisibleCount(WINDOW_SIZE);
  }, [threadId]);

  const toBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowFab(false);
  };

  return (
    <>
      <StatusGroup notices={notices} />
      <div id="log" className="message-list" ref={scrollRef} onScroll={onScroll} aria-live="polite">
        {hiddenCount > 0 ? (
          <button type="button" className="text-btn" onClick={() => setVisibleCount((c) => c + EXPAND_STEP)}>
            加载更早消息（{hiddenCount}）
          </button>
        ) : null}
        {windowed.map((message) => (
          <MessageRow key={message.id} message={message} onLongPress={onLongPress} />
        ))}
      </div>
      {showFab ? (
        <button type="button" id="scrollPill" className="scroll-fab show" aria-label="回到最新消息" onClick={toBottom}>
          <Icon name="arrow_downward" size={18} />
        </button>
      ) : null}
      <RunState />
    </>
  );
}

function RunState() {
  const run = useStoreSelector((s) => s.run);
  const suffix = run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : "";
  return (
    <div id="runState" className="run-state" data-state={run.state} role="status" aria-live="polite">
      <span className="run-state-dot" aria-hidden="true" />
      <span id="runStateLabel">{`${run.label}${suffix}`}</span>
    </div>
  );
}

export function UsageBadge() {
  const usage = useStoreSelector((s) => s.usage);
  if (!usage?.total) return null;
  const total = usage.total.totalTokens || 0;
  const input = usage.total.inputTokens || 0;
  const output = usage.total.outputTokens || 0;
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <div className="usage-badge" title={`累计 ${total} tokens`}>
      ↑{fmt(input)} ↓{fmt(output)} · 共 {fmt(total)}
    </div>
  );
}
