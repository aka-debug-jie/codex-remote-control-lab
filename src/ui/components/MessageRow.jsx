import React, { useRef } from "react";
import { Markdown } from "./Markdown.jsx";
import { ToolCard } from "./ToolCard.jsx";
import { authedUrl } from "../lib/api.js";
import { long as longHaptic } from "../lib/haptic.js";

export function messageText(message) {
  return message.parts
    .map((part) => {
      if (part.type === "text") return part.raw ?? part.text ?? "";
      if (part.type === "attachments") return (part.items || []).map((a) => a.name).join(" ");
      if (part.type === "tool") return [part.name, part.input?.command, part.output, part.diff].filter(Boolean).join(" ");
      return "";
    })
    .join(" ");
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL = 10;

export const MessageRow = React.memo(function MessageRow({ message, onLongPress }) {
  const pressRef = useRef(null);

  const startPress = (e) => {
    if (!onLongPress) return;
    const t = e.touches ? e.touches[0] : e;
    pressRef.current = { x: t.clientX, y: t.clientY };
    pressRef.current.timer = setTimeout(() => {
      pressRef.current = null;
      longHaptic();
      onLongPress(message);
    }, LONG_PRESS_MS);
  };
  const movePress = (e) => {
    const p = pressRef.current;
    if (!p) return;
    const t = e.touches ? e.touches[0] : e;
    if (Math.abs(t.clientX - p.x) > MOVE_CANCEL || Math.abs(t.clientY - p.y) > MOVE_CANCEL) {
      clearTimeout(p.timer);
      pressRef.current = null;
    }
  };
  const endPress = () => {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  const longPressHandlers = {
    onTouchStart: startPress,
    onTouchMove: movePress,
    onTouchEnd: endPress,
    onTouchCancel: endPress,
    onMouseDown: startPress,
    onMouseMove: movePress,
    onMouseUp: endPress,
    onMouseLeave: endPress,
  };

  if (message.role === "status") {
    return (
      <article className="entry status">
        <div className="entry-body">{message.parts.map((p) => p.text).join("")}</div>
      </article>
    );
  }
  if (message.role === "tool") {
    return (
      <article className="entry tool">
        <div className="entry-body">
          {message.parts.map((p, i) => (p.type === "tool" ? <ToolCard key={i} part={p} /> : null))}
        </div>
      </article>
    );
  }
  if (message.role === "reasoning") {
    const text = message.parts.map((p) => p.text || "").join("");
    if (!text.trim()) return null;
    return (
      <article className="entry reasoning">
        <details className="reasoning-card">
          <summary>思考过程</summary>
          <div className="reasoning-body">{text}</div>
        </details>
      </article>
    );
  }

  const text = message.parts.filter((p) => p.type === "text").map((p) => p.raw ?? p.text ?? "").join("");
  const attachments = message.parts.find((p) => p.type === "attachments");
  return (
    <article className={`entry ${message.role}`} {...longPressHandlers}>
      <Markdown text={text} streaming={message.status === "streaming"} />
      {attachments ? (
        <div className="entry-gallery">
          {attachments.items.map((a, i) => (
            <img key={i} src={authedUrl(a.url) || a.url} alt={a.name} loading="lazy" />
          ))}
        </div>
      ) : null}
    </article>
  );
});
