import React, { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, GitBranch, Globe2, TerminalSquare, X } from "lucide-react";
import { api } from "./api.js";
import { themeOptions } from "./constants.js";

const TABS = [
  { id: "artifacts", domId: "artifactTab", label: "产物", icon: FileText },
  { id: "workspace", domId: "workspaceTab", label: "Files", icon: FolderOpen },
  { id: "review", domId: "reviewTab", label: "Diff", icon: GitBranch },
  { id: "status", domId: "statusButton", label: "Run", icon: TerminalSquare },
  { id: "sources", domId: "webSearchButton", label: "Web", icon: Globe2 },
];

const TOOL_TITLES = { models: "模型", plugins: "插件", automations: "自动化", settings: "设置" };

function PanelRow({ text, detail, icon, onClick, disabled, actions }) {
  return (
    <button type="button" className={`artifact-row${icon ? "" : " no-icon"}`} onClick={onClick} disabled={disabled}>
      {icon ? <span className="panel-row-icon" aria-hidden="true">{icon}</span> : null}
      <span className="panel-row-copy">
        <strong>{text}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {actions ? <span className="row-actions" aria-hidden="true">{actions}</span> : null}
    </button>
  );
}

export const Panels = React.memo(function Panels({ open, activePanel, toolView, onTab, onClose, artifacts, appendToPrompt, onSelectModel, theme, onTheme }) {
  const [title, setTitle] = useState("产物");
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setPanel = (nextTitle, nextRows) => {
    setTitle(nextTitle);
    setRows(nextRows);
    setPreview(null);
    setError("");
  };

  const loadArtifacts = useCallback(() => {
    setPanel("产物", (artifacts || []).map((a) => ({ key: a.path || a.name, text: a.name || a.path, detail: a.path || "", icon: "MD", onClick: () => openFile(a.path || a.name) })));
  }, [artifacts]);

  const openFile = useCallback(async (path) => {
    try {
      const file = await api.file(path);
      setPreview(file);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const current = toolView || activePanel;
    setLoading(true);
    (async () => {
      try {
        if (current === "artifacts") {
          loadArtifacts();
        } else if (current === "workspace") {
          const result = await api.workspace();
          setPanel(
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
              onDouble: () => openFile(entry.path),
            })),
          );
        } else if (current === "review") {
          const result = await api.review();
          if (result.notGitRepo) {
            setPanel("审查", [{ key: "none", text: "当前工作目录不是 Git 仓库", detail: "Diff 功能不可用", icon: "Δ" }]);
          } else {
            const list = [];
            list.push({ key: "branch", text: "分支", detail: result.branch || "unknown", icon: "G" });
            (result.stat || []).forEach((line, i) => list.push({ key: `s${i}`, text: line.trim(), icon: "Σ" }));
            (result.files || []).forEach((file) => list.push({ key: file.path, text: file.path, detail: file.status, icon: file.status || "MOD", onClick: () => (file.openable ? openFile(file.path) : appendToPrompt(`审查目标：${file.path}`)) }));
            setPanel(result.clean ? "审查（无更改）" : `审查（${(result.files || []).length} 处更改）`, list);
          }
        } else if (current === "status") {
          const result = await api.status(true);
          setPanel("后台", [
            { key: "p", text: "Provider", detail: result.provider || "", icon: "▸" },
            { key: "u", text: "UI port", detail: String(result.uiPort ?? ""), icon: "▸" },
            { key: "c", text: "Codex app-server", detail: result.codexUrl || "未使用", icon: "▸" },
            { key: "h", text: "历史同步", detail: result.historySyncEnabled ? "启用" : "禁用", icon: "▸" },
            { key: "loc", text: "当前位置", detail: result.workspaceLocation || result.workdir || "", icon: "▸" },
            { key: "br", text: "Git 分支", detail: result.gitBranch || "未知", icon: "▸" },
          ]);
        } else if (current === "sources") {
          setPanel("信息来源", [
            { key: "web", text: "将 Web 检索加入输入", detail: "在需要外部确认的回合使用", icon: "WEB", onClick: () => appendToPrompt("请使用 Web 检索进行确认。") },
            { key: "file", text: "本地文件", detail: "可在 Files 标签页添加 @path", icon: "FILE", onClick: () => onTab("workspace") },
            { key: "diff", text: "差异审查", detail: "可在 Diff 标签页添加变更文件", icon: "DIFF", onClick: () => onTab("review") },
          ]);
        } else if (current === "models") {
          const result = await api.models();
          setPanel(
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
          const result = await api.plugins();
          const list = [];
          for (const marketplace of result.marketplaces || result.data || []) {
            for (const plugin of marketplace.plugins || marketplace.entries || []) {
              const summary = plugin?.summary || plugin || {};
              const status = summary.enabled ? "enabled" : summary.installed ? "installed" : null;
              if (status) list.push({ key: summary.id || summary.name, text: summary.name || summary.id, detail: status, icon: "P" });
            }
          }
          setPanel("插件", list.length ? list : [{ key: "none", text: "没有已安装或启用的插件", icon: "P" }]);
        } else if (current === "automations") {
          const result = await api.automations();
          const list = (result.data || []).map((a) => ({ key: a.id, text: a.name, detail: a.status, icon: "A" }));
          setPanel("自动化", list.length ? list : [{ key: "none", text: "没有已注册的自动化", icon: "A" }]);
        } else if (current === "settings") {
          setPanel("设置", []);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePanel, toolView, artifacts]);

  const current = toolView || activePanel;

  return (
    <aside className="artifact-panel" id="artifactPanel" aria-label="右侧面板">
      <div className="sidebar-resize-handle right-resize-handle" id="rightResizeHandle" role="separator" aria-orientation="vertical" aria-label="调整右侧栏宽度" tabIndex={0} />
      <section className="panel-card primary-panel">
        <div className="panel-title">
          <span id="artifactTitle">{toolView ? TOOL_TITLES[toolView] || title : title}</span>
          <button type="button" className="panel-close" id="closePanelButton" title="关闭" aria-label="关闭右侧面板" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="panel-tabs" role="toolbar" aria-label="切换右侧面板">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={`panel-tab${current === tab.id ? " active" : ""}`} id={tab.domId} data-panel-tab={tab.id} aria-label={tab.label} title={tab.label} aria-pressed={current === tab.id} onClick={() => onTab(tab.id)}>
                <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
                <span className="sr-only">{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div id="artifactList" className={current === "artifacts" || current === "workspace" || current === "review" ? "artifact-browser-list" : ""}>
          {current === "settings" ? (
            <section className="theme-settings">
              <div className="theme-settings-title">配色主题</div>
              <div className="theme-options">
                {themeOptions.map((option) => (
                  <button key={option.id} type="button" className={`theme-option${theme === option.id ? " active" : ""}`} onClick={() => onTheme(option.id)}>
                    <span className="theme-swatch" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <strong>{option.name}</strong>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {loading ? <PanelRow text="加载中..." /> : null}
          {error ? <PanelRow text="加载失败" detail={error} /> : null}
          {rows.map((row) =>
            row.onDouble ? (
              <PanelRow key={row.key} text={row.text} detail={row.detail} icon={row.icon} disabled={row.disabled} onClick={row.onClick} actions="添加" />
            ) : (
              <PanelRow key={row.key} text={row.text} detail={row.detail} icon={row.icon} disabled={row.disabled} onClick={row.onClick} />
            ),
          )}
        </div>
        {preview ? (
          <div id="artifactPreview" className="artifact-preview">
            <div className="artifact-preview-header">
              <span>{preview.path || preview.name}</span>
              <button type="button" className="artifact-preview-close" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
            {preview.kind === "image" || preview.url ? (
              <img src={preview.url} alt={preview.path || "preview"} />
            ) : (
              <pre>{preview.text || ""}</pre>
            )}
          </div>
        ) : null}
      </section>
    </aside>
  );
});
