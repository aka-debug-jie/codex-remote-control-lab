import React, { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";

export function PromptDialog({ open, value, onCancel, onApply }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, open]);
  if (!open) return null;
  return (
    <section className="fullscreen-dialog" id="promptModal" role="dialog" aria-modal="true" aria-labelledby="promptModalTitle">
      <div className="fullscreen-dialog-header">
        <button type="button" className="icon-btn" id="closePromptModalButton" aria-label="关闭" onClick={() => onApply(draft)}>
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
