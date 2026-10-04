import React from "react";
import { BottomSheet } from "./BottomSheet.jsx";
import { Icon } from "./Icon.jsx";

export function MessageActionSheet({ open, onClose, message, onEdit, onRetry }) {
  const text = message
    ? message.parts
        .filter((p) => p.type === "text")
        .map((p) => p.raw ?? p.text ?? "")
        .join("")
    : "";
  const role = message?.role;

  const copy = () => {
    if (text.trim() && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    onClose();
  };
  const share = () => {
    if (navigator.share && text.trim()) navigator.share({ text }).catch(() => {});
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="消息操作" labelledBy="actionSheetTitle">
      <button type="button" className="list-row" onClick={copy}>
        <span className="list-row-icon"><Icon name="content_copy" size={20} /></span>
        <span className="list-row-copy"><strong>复制</strong></span>
      </button>
      <button type="button" className="list-row" onClick={share}>
        <span className="list-row-icon"><Icon name="share" size={20} /></span>
        <span className="list-row-copy"><strong>分享</strong></span>
      </button>
      {role === "user" ? (
        <>
          <button
            type="button"
            className="list-row"
            onClick={() => {
              onEdit?.(text);
              onClose();
            }}
          >
            <span className="list-row-icon"><Icon name="edit" size={20} /></span>
            <span className="list-row-copy"><strong>编辑重发</strong></span>
          </button>
          <button
            type="button"
            className="list-row"
            onClick={() => {
              onRetry?.(text);
              onClose();
            }}
          >
            <span className="list-row-icon"><Icon name="restart_alt" size={20} /></span>
            <span className="list-row-copy"><strong>重试</strong></span>
          </button>
        </>
      ) : null}
    </BottomSheet>
  );
}
