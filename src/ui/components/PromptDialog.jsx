import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

// Fullscreen composer editor. Semantics are consistent by design:
// 应用/Enter persist the draft, while ✕/Escape/取消 cancel — edits are never
// silently committed by an ambiguous "close".
export function PromptDialog({ open, value, onCancel, onApply }) {
  const [draft, setDraft] = useState(value);
  const dialogRef = useRef(null);
  useEffect(() => setDraft(value), [value, open]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const focusables = () =>
      dialog ? [...dialog.querySelectorAll("button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex=\"-1\"])")] : [];
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      try {
        previouslyFocused && previouslyFocused.focus();
      } catch {
        /* ignore */
      }
    };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <section
      ref={dialogRef}
      className="fullscreen-dialog"
      id="promptModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promptModalTitle"
    >
      <div className="fullscreen-dialog-header">
        <button type="button" className="icon-btn" id="closePromptModalButton" aria-label="取消编辑" onClick={onCancel}>
          <Icon name="close" />
        </button>
        <h2 id="promptModalTitle">编辑输入</h2>
        <span style={{ width: 44 }} aria-hidden="true" />
      </div>
      <textarea
        id="promptModalInput"
        className="prompt-modal-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        placeholder="输入后续修改要求"
      />
      <footer className="fullscreen-dialog-footer">
        <button type="button" className="text-btn secondary" id="cancelPromptModalButton" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="filled-btn" id="applyPromptModalButton" onClick={() => onApply(draft)}>
          应用
        </button>
      </footer>
    </section>
  );
}
