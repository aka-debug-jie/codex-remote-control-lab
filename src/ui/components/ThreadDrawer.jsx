import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

function formatRelativeTime(value) {
  let ts = Number(value) || 0;
  if (!ts) return "";
  // The bridge reports Unix time in seconds; normalize to milliseconds.
  if (ts < 1e12) ts *= 1000;
  const delta = Date.now() - ts;
  if (delta < 0) return "刚刚";
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分钟`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}小时`;
  return `${Math.floor(delta / 86_400_000)}天`;
}

function titleForThread(thread) {
  return thread?.name || thread?.title || thread?.preview || thread?.id || "会话";
}

export function ThreadDrawer({ open, onOpen, onClose, threads, selectedThread, search, onSearch, onSelect, onNew, onTool }) {
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef(null);
  const drawerRef = useRef(null);

  // Keep the closed drawer out of the a11y tree and Tab order (aria-hidden
  // alone leaves its buttons focusable).
  useEffect(() => {
    const drawer = drawerRef.current;
    if (drawer) drawer.toggleAttribute("inert", !open);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((t) => `${titleForThread(t)} ${t.id}`.toLowerCase().includes(needle));
  }, [threads, search]);

  // Edge-swipe to open: track a touch starting within 24px of the left edge.
  useEffect(() => {
    let tracking = false;
    let startX = 0;
    let startY = 0;
    const onStart = (e) => {
      if (open) return;
      const t = e.touches ? e.touches[0] : e;
      if (t.clientX <= 24) {
        tracking = true;
        startX = t.clientX;
        startY = t.clientY;
      }
    };
    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientY - startY) > 40 && Math.abs(t.clientX - startX) < 12) {
        tracking = false;
        return;
      }
      if (t.clientX - startX > 60) {
        tracking = false;
        onOpen();
      }
    };
    const onEnd = () => {
      tracking = false;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [open, onOpen]);

  const startDrag = (e) => {
    dragRef.current = { x: e.touches ? e.touches[0].clientX : e.clientX, moved: false };
  };
  const onDrag = (e) => {
    if (!dragRef.current) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const delta = Math.max(0, dragRef.current.x - x);
    if (delta > 6) dragRef.current.moved = true;
    setDragX(delta);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    if (dragRef.current.moved && dragX > 80) onClose();
    dragRef.current = null;
    setDragX(0);
  };

  return (
    <>
      <div className={`drawer-scrim${open ? " open" : ""}`} id="sidebarScrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={drawerRef}
        className={`drawer glass-edge${open ? " open" : ""}`}
        id="threadSidebar"
        aria-label="会话"
        aria-hidden={!open}
        style={dragX ? { transform: `translateX(${-dragX}px)`, transition: "none" } : undefined}
        onTouchStart={startDrag}
        onTouchMove={onDrag}
        onTouchEnd={endDrag}
      >
        <div className="drawer-header">
          <div className="drawer-brand">
            <span className="dot" aria-hidden="true" />
            Codex
          </div>
        </div>
        <nav className="primary-nav" aria-label="主要操作">
          <button type="button" className="nav-command" id="newThread" onClick={onNew}>
            <span className="command-icon"><Icon name="add" /></span>
            <span>新会话</span>
          </button>
          <button type="button" className="nav-command" id="pluginsButton" onClick={() => onTool("plugins")}>
            <span className="command-icon"><Icon name="extension" /></span>
            <span>插件</span>
          </button>
          <button type="button" className="nav-command" id="automationsButton" onClick={() => onTool("automations")}>
            <span className="command-icon"><Icon name="account_tree" /></span>
            <span>自动化</span>
          </button>
        </nav>
        <div className="drawer-section">
          <div className="section-title">最近的会话</div>
          <input
            id="threadSearch"
            className="thread-search"
            type="search"
            placeholder="搜索会话"
            aria-label="搜索会话"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <div id="threadList" className="thread-list">
            {filtered.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread-item${thread.id === selectedThread ? " active" : ""}`}
                onClick={() => onSelect(thread.id)}
              >
                <span className="thread-item-title">{titleForThread(thread)}</span>
                <span className="thread-item-time">{formatRelativeTime(thread.updatedAt || thread.createdAt)}</span>
              </button>
            ))}
            {!filtered.length ? <div className="empty-hint">没有匹配的会话</div> : null}
          </div>
        </div>
        <button type="button" className="settings" id="settingsButton" aria-label="设置" onClick={() => onTool("settings")}>
          <span className="command-icon"><Icon name="settings" /></span>
          <span>设置</span>
        </button>
      </aside>
    </>
  );
}
