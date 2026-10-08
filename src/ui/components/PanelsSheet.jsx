import React, { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet } from "./BottomSheet.jsx";
import { Icon } from "./Icon.jsx";
import { api, authedUrl, isAbortError } from "../lib/api.js";
import { themeOptions } from "../lib/constants.js";

const TABS = [
  { id: "artifacts", domId: "artifactTab", label: "产物", icon: "description" },
  { id: "workspace", domId: "workspaceTab", label: "Files", icon: "folder_open" },
  { id: "review", domId: "reviewTab", label: "Diff", icon: "difference" },
  { id: "status", domId: "statusButton", label: "Run", icon: "terminal" },
  { id: "sources", domId: "webSearchButton", label: "Web", icon: "travel_explore" },
];

const TOOL_TITLES = { models: "模型", plugins: "插件", automations: "自动化", settings: "设置" };

function Row({ text, detail, icon, onClick, disabled, active, trailing }) {
  return (
    <button type="button" className={`list-row${active ? " active" : ""}`} onClick={onClick} disabled={disabled}>
      {icon ? <span className="list-row-icon">{icon}</span> : null}
      <span className="list-row-copy">
        <strong>{text}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {trailing}
    </button>
  );
}

export function PanelsSheet({
  open,
  activePanel,
  toolView,
  onTab,
  onClose,
  artifacts,
  appendToPrompt,
  onSelectModel,
  theme,
  onTheme,
}) {
  const [title, setTitle] = useState("产物");
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  // Request generations: only the newest panel request and the newest file
  // request may write state, so a slow earlier response can never overwrite a
  // later panel (or flash an old preview back after the sheet was closed).
  const panelKeyRef = useRef(null);
  const panelGenRef = useRef(0);
  const panelAbortRef = useRef(null);
  const fileGenRef = useRef(0);
  const fileAbortRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Historical artifacts for the (sync) artifacts panel; the array identity is
  // meaningful so a new artifact list triggers exactly one refresh.
  // eslint-disable-next-line no-unused-vars
  const artifactListKey = artifacts;

  const openFile = useCallback(async (path) => {
    if (fileAbortRef.current) fileAbortRef.current.abort();
    const controller = new AbortController();
    fileAbortRef.current = controller;
    const gen = ++fileGenRef.current;
    const isCurrent = () => fileGenRef.current === gen && !controller.signal.aborted && openRef.current;
    setError("");
    try {
      const file = await api.file(path, { signal: controller.signal });
      if (!isCurrent()) return;
      setPreview(file);
    } catch (e) {
      if (isAbortError(e) || !isCurrent()) return;
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (toolView === "settings") return; // rendered from themeOptions directly
    const current = toolView || activePanel;
    const key = `open|${current}`;
    const isNewPanel = panelKeyRef.current !== key;
    panelKeyRef.current = key;

    if (panelAbortRef.current) panelAbortRef.current.abort();
    const controller = new AbortController();
    panelAbortRef.current = controller;
    const gen = ++panelGenRef.current;
    const isCurrent = () => panelGenRef.current === gen && !controller.signal.aborted && openRef.current;

    if (isNewPanel) {
      // Never mix two different panels' content while the next one loads.
      setRows([]);
      setPreview(null);
    }
    setLoading(true);
    setError("");

    const applyPanel = (nextTitle, nextRows) => {
      if (!isCurrent()) return;
      setTitle(nextTitle);
      setRows(nextRows);
      setError("");
      setLoading(false);
    };

    (async () => {
      const signal = controller.signal;
      try {
        if (current === "artifacts") {
          applyPanel(
            "产物",
            (artifacts || []).map((a) => ({ key: a.path || a.name, text: a.name || a.path, detail: a.path || "", icon: "MD", onClick: () => openFile(a.path || a.name) })),
          );
        } else if (current === "workspace") {
          const result = await api.workspace(undefined, { signal });
          if (!isCurrent()) return;
          applyPanel(
            "工作区",
            (result.data || []).map((entry) => ({
              key: entry.path,
              text: entry.name || entry.path,
              detail: entry.path,
              icon: entry.type === "directory" ? "DIR" : entry.kind === "image" ? "IMG" : entry.kind === "markdown" ? "MD" : "FILE",
              disabled: entry.type === "directory",
              onClick: () => {
                if (entry.type === "directory") return;
                appendToPrompt(`@${entry.path}`);
              },
            })),
          );
        } else if (current === "review") {
          const result = await api.review({ signal });
          if (!isCurrent()) return;
          if (result.notGitRepo) {
            applyPanel("审查", [{ key: "none", text: "当前工作目录不是 Git 仓库", detail: "Diff 功能不可用", icon: "Δ" }]);
          } else {
            const list = [];
            const source = result.displaySource || result.source || "working tree";
            const isLatest = source === "latest commit";
            list.push({ key: "branch", text: "分支", detail: result.branch || "unknown", icon: "G" });
            list.push({ key: "source", text: "来源", detail: isLatest ? "最近提交（工作树无更改）" : "工作树（未提交改动）", icon: "◈" });
            (result.stat || []).forEach((line, i) => list.push({ key: `s${i}`, text: line.trim(), icon: "Σ" }));
            (result.files || []).forEach((file) => list.push({ key: file.path, text: file.path, detail: file.status, icon: file.status || "MOD", onClick: () => (file.openable ? openFile(file.path) : appendToPrompt(`审查目标：${file.path}`)) }));
            applyPanel(
              isLatest
                ? `审查（最近提交 ${(result.files || []).length} 处）`
                : result.clean
                  ? "审查（工作树无更改）"
                  : `审查（${(result.files || []).length} 处更改）`,
              list,
            );
          }
        } else if (current === "status") {
          const result = await api.status(true, { signal });
          if (!isCurrent()) return;
          applyPanel("后台", [
            { key: "p", text: "Provider", detail: result.provider || "", icon: "▸" },
            { key: "u", text: "UI port", detail: String(result.uiPort ?? ""), icon: "▸" },
            { key: "c", text: "Codex app-server", detail: result.codexUrl || "未使用", icon: "▸" },
            { key: "h", text: "历史同步", detail: result.historySyncEnabled ? "启用" : "禁用", icon: "▸" },
            { key: "loc", text: "当前位置", detail: result.workspaceLocation || result.workdir || "", icon: "▸" },
            { key: "br", text: "Git 分支", detail: result.gitBranch || "未知", icon: "▸" },
          ]);
        } else if (current === "sources") {
          applyPanel("信息来源", [
            { key: "web", text: "将 Web 检索加入输入", detail: "在需要外部确认的回合使用", icon: "WEB", onClick: () => appendToPrompt("请使用 Web 检索进行确认。") },
            { key: "file", text: "本地文件", detail: "可在 Files 标签页添加 @path", icon: "FILE", onClick: () => onTab("workspace") },
            { key: "diff", text: "差异审查", detail: "可在 Diff 标签页添加变更文件", icon: "DIFF", onClick: () => onTab("review") },
          ]);
        } else if (current === "models") {
          const result = await api.models({ signal });
          if (!isCurrent()) return;
          applyPanel(
            "模型",
            (result.data || []).slice(0, 24).map((c) => ({
              key: c.model || c.id,
              text: c.displayName || c.model || c.id,
              detail: c.defaultReasoningEffort || "",
              icon: "M",
              onClick: () => onSelectModel(c.model || c.id),
            })),
          );
        } else if (current === "plugins") {
          const result = await api.plugins({ signal });
          if (!isCurrent()) return;
          const list = [];
          for (const marketplace of result.marketplaces || result.data || []) {
            for (const plugin of marketplace.plugins || marketplace.entries || []) {
              const summary = plugin?.summary || plugin || {};
              const status = summary.enabled ? "enabled" : summary.installed ? "installed" : null;
              if (status) list.push({ key: summary.id || summary.name, text: summary.name || summary.id, detail: status, icon: "P" });
            }
          }
          applyPanel("插件", list.length ? list : [{ key: "none", text: "没有已安装或启用的插件", icon: "P" }]);
        } else if (current === "automations") {
          const result = await api.automations({ signal });
          if (!isCurrent()) return;
          const list = (result.data || []).map((a) => ({ key: a.id, text: a.name, detail: a.status, icon: "A" }));
          applyPanel("自动化", list.length ? list : [{ key: "none", text: "没有已注册的自动化", icon: "A" }]);
        } else if (isCurrent()) {
          setLoading(false);
        }
      } catch (e) {
        if (isAbortError(e)) return;
        if (!isCurrent()) return;
        setError(e.message);
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      if (panelAbortRef.current === controller) panelAbortRef.current = null;
      // Navigating away or closing the sheet invalidates in-flight previews too.
      fileAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePanel, toolView, artifactListKey, retryNonce]);

  const current = toolView || activePanel;
  const heading = toolView ? TOOL_TITLES[toolView] || title : title;

  return (
    <BottomSheet open={open} onClose={onClose} title={heading} labelledBy="artifactTitle">
      {toolView === "settings" ? (
        <section className="theme-settings">
          <div className="section-title">配色主题</div>
          <div className="theme-options">
            {themeOptions.map((option) => (
              <button key={option.id} type="button" className={`theme-option${theme === option.id ? " active" : ""}`} onClick={() => onTheme(option.id)}>
                <span className="theme-swatch" aria-hidden="true"><span /><span /><span /></span>
                <span className="list-row-copy">
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </span>
                {theme === option.id ? <span className="checkmark">✓</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          {(toolView == null) ? (
            <div className="panel-tabs" role="toolbar" aria-label="切换面板">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`panel-tab${current === tab.id ? " active" : ""}`}
                  id={tab.domId}
                  data-panel-tab={tab.id}
                  aria-label={tab.label}
                  title={tab.label}
                  aria-pressed={current === tab.id}
                  onClick={() => onTab(tab.id)}
                >
                  <Icon name={tab.icon} size={20} />
                </button>
              ))}
            </div>
          ) : null}
          <div id="artifactList">
            {loading ? <Row text={rows.length ? "刷新中…" : "加载中..."} /> : null}
            {error ? (
              <Row
                text="加载失败"
                detail={error}
                trailing={
                  <button type="button" className="text-btn" onClick={() => setRetryNonce((n) => n + 1)}>
                    重试
                  </button>
                }
              />
            ) : null}
            {rows.map((row) => (
              <Row
                key={row.key}
                text={row.text}
                detail={row.detail}
                icon={row.icon ? <span>{row.icon}</span> : null}
                disabled={row.disabled}
                onClick={row.onClick}
              />
            ))}
            {preview ? (
              <div id="artifactPreview" className="artifact-preview">
                <div className="artifact-preview-header">
                  <span>{preview.path || preview.name}</span>
                  <button type="button" className="text-btn" onClick={() => setPreview(null)}>关闭</button>
                </div>
                {preview.kind === "image" || preview.url ? (
                  <img src={authedUrl(preview.url) || preview.url} alt={preview.path || "preview"} />
                ) : (
                  <>
                    <pre>{preview.text || ""}</pre>
                    {preview.truncated ? (
                      <p className="artifact-preview-note">已截断显示（文件较大，仅显示前 80000 字符）</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
