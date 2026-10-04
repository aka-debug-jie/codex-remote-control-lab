import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

// Modal bottom sheet with drag-down-to-dismiss (MD3 modal bottom sheet).
export function BottomSheet({ open, onClose, title, children, labelledBy }) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      return undefined;
    }
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startDrag = (e) => {
    dragRef.current = { y: e.touches ? e.touches[0].clientY : e.clientY, moved: false };
  };
  const onDrag = (e) => {
    if (!dragRef.current) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = Math.max(0, y - dragRef.current.y);
    if (delta > 6) dragRef.current.moved = true;
    setDragY(delta);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    const shouldClose = dragRef.current.moved && dragY > 90;
    dragRef.current = null;
    if (shouldClose) onClose?.();
    else setDragY(0);
  };

  return (
    <>
      <div className={`sheet-scrim${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={`bottom-sheet glass-edge${open ? " open" : ""}`}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <div
          className="sheet-handle"
          role="separator"
          aria-label="拖动关闭"
          onTouchStart={startDrag}
          onTouchMove={onDrag}
          onTouchEnd={endDrag}
          onMouseDown={startDrag}
          onMouseMove={(e) => dragRef.current && onDrag(e)}
          onMouseUp={endDrag}
        />
        {title ? (
          <div className="sheet-title">
            <span id={labelledBy}>{title}</span>
            <button type="button" className="sheet-close" aria-label="关闭" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}
