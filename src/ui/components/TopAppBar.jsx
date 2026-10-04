import React from "react";
import { Icon } from "./Icon.jsx";

export function TopAppBar({
  title,
  status,
  scrolled,
  searching,
  searchQuery,
  searchCount,
  onOpenDrawer,
  onToggleSearch,
  onSearchChange,
  onReconnect,
  onMenu,
  connecting,
}) {
  if (searching) {
    return (
      <header className="top-app-bar glass-edge scrolled">
        <button type="button" className="icon-btn" id="closeSearch" aria-label="关闭搜索" onClick={onToggleSearch}>
          <Icon name="arrow_back" />
        </button>
        <div className="search-field">
          <Icon name="search" size={18} />
          <input
            id="messageSearch"
            type="search"
            placeholder="在会话中搜索…"
            aria-label="在会话中搜索"
            value={searchQuery}
            autoFocus
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery ? <span className="message-search-count">{searchCount} 条</span> : null}
          {searchQuery ? (
            <button type="button" className="message-search-clear" aria-label="清除搜索" onClick={() => onSearchChange("")}>
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>
      </header>
    );
  }

  return (
    <header className={`top-app-bar glass-edge${scrolled ? " scrolled" : ""}`}>
      <button
        type="button"
        className="icon-btn"
        id="mobileThreads"
        aria-controls="threadSidebar"
        aria-label="会话列表"
        onClick={onOpenDrawer}
      >
        <Icon name="menu" />
      </button>
      <div className="title-stack">
        <h1 id="threadTitle">{title || "Codex Remote"}</h1>
        <p id="meta">{status}</p>
      </div>
      <div className="title-actions">
        <button type="button" className="icon-btn" id="searchButton2" aria-label="搜索消息" onClick={onToggleSearch}>
          <Icon name="search" />
        </button>
        <button
          type="button"
          className={`icon-btn${connecting ? " spinning" : ""}`}
          id="connect"
          title="重新连接"
          aria-label="重新连接"
          onClick={onReconnect}
        >
          <Icon name="refresh" />
        </button>
        <button type="button" className="icon-btn" id="menuButton" title="更多" aria-label="更多" onClick={onMenu}>
          <Icon name="more_vert" />
        </button>
      </div>
    </header>
  );
}
