import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  Maximize2,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  TerminalSquare,
  Workflow,
  X,
} from "lucide-react";
import { createStore, runStateText } from "./store.js";
import { createConnection } from "./connection.js";
import { api, initialThread, token } from "./api.js";
import { loadCachedMessages, saveCachedMessages, loadScroll, saveScroll } from "./cache.js";
import { renderMarkdown, highlightCode } from "./markdown.js";
import {
  accessModes,
  compactWorkspaceLocation,
  modelChoices,
  reasoningEffortValue,
  reasoningLevels,
  themeOptions,
} from "./constants.js";
import { Panels } from "./Panels.jsx";

const store = createStore();
const connection = createConnection(store, {
  onThreadChange(threadId) {
    const url = new URL(location.href);
    if (threadId) url.searchParams.set("thread", threadId);
    else url.searchParams.delete("thread");
    history.replaceState(null, "", url.pathname + url.search);
  },
});

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) if (!Object.is(a[key], b[key])) return false;
  return true;
}

// Subscribe to a slice of the store; only re-renders when the slice changes by
// shallow equality, so streaming deltas do not re-render the whole app shell.
function useStoreSelector(selector, equality = shallowEqual) {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef();
  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    if (cacheRef.current !== undefined && equality(cacheRef.current, next)) return cacheRef.current;
    cacheRef.current = next;
    return next;
  }, [equality]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
      />
    </svg>
  );
}

function formatRelativeTime(value) {
  const ts = Number(value) || 0;
  if (!ts) return "";
  const delta = Date.now() - ts;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分钟`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}小时`;
  return `${Math.floor(delta / 86_400_000)}天`;
}

function titleForThread(thread) {
  return thread?.name || thread?.title || thread?.preview || thread?.id || "会话";
}

// Split a streaming message at the last stable block boundary so only the tail
// block is re-parsed on each delta (closed blocks keep their HTML).
function incrementalSplit(text) {
  if (!text) return 0;
  let last = 0;
  const re = /\n[ \t]*\n/g;
  let match;
  while ((match = re.exec(text))) last = match.index + match[0].length;
  if (last === 0) return 0;
  const before = text.slice(0, last);
  const fencesBefore = (before.match(/^```/gm) || []).length;
  if (fencesBefore % 2 === 1) {
    const open = before.lastIndexOf("```");
    const prev = text.lastIndexOf("\n\n", Math.max(0, open - 1));
    return prev > 0 ? prev + 2 : 0;
  }
  return last;
}

const Markdown = React.memo(function Markdown({ text, streaming }) {
  const value = text || "";
  const split = streaming ? incrementalSplit(value) : value.length;
  const prefix = value.slice(0, split);
  const tail = value.slice(split);
  const prefixHtml = useMemo(() => renderMarkdown(prefix), [prefix]);
  const tailHtml = useMemo(() => renderMarkdown(tail), [tail]);
  const ref = useRef(null);
  // Defer syntax highlighting until the stream settles, and only for code
  // blocks that have not been highlighted yet.
  useEffect(() => {
    if (streaming) return;
    const node = ref.current;
    if (!node) return;
    const handle = requestAnimationFrame(() => {
      for (const code of node.querySelectorAll("pre[data-language] code:not([data-hl])")) {
        const language = code.parentElement.getAttribute("data-language");
        code.innerHTML = highlightCode(code.textContent, language);
        code.setAttribute("data-hl", "1");
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [prefixHtml, tailHtml, streaming]);
  return (
    <div
      ref={ref}
      className={`entry-body${streaming ? " streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: prefixHtml + tailHtml }}
    />
  );
});

function MessageActions({ text, role, onEdit, onRetry }) {
  const [copied, setCopied] = useState(false);
  const value = text || "";
  const copy = () => {
    if (!value.trim()) return;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done, () => {});
    else done();
  };
  const share = () => {
    if (navigator.share) navigator.share({ text: value }).catch(() => {});
    else copy();
  };
  return (
    <div className="entry-tools">
      <button type="button" className={`entry-action${copied ? " copied" : ""}`} aria-label="复制" title={copied ? "已复制" : "复制"} onClick={copy}>
        {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.9} />}
      </button>
      <button type="button" className="entry-action" aria-label="分享" title="分享" onClick={share}>
        <Share2 size={15} strokeWidth={1.9} />
      </button>
      {role === "user" ? (
        <>
          <button type="button" className="entry-action" aria-label="编辑重发" title="编辑重发" onClick={() => onEdit?.(value)}>
            <Pencil size={15} strokeWidth={1.9} />
          </button>
          <button type="button" className="entry-action" aria-label="重试" title="重试" onClick={() => onRetry?.(value)}>
            <RotateCcw size={15} strokeWidth={1.9} />
          </button>
        </>
      ) : null}
    </div>
  );
}

function ToolPart({ part }) {
  const running = part.status === "running";
  const exit = part.exitCode;
  const output = part.output || "";
  const diff = part.diff || "";
  return (
    <div className={`tool-card${running ? " running" : ""}`}>
      <div className="tool-card-head">
        <span className={`tool-kind tool-kind-${part.kind || "tool"}`}>{part.kind === "fileChange" ? "DIFF" : "CMD"}</span>
        <span className="tool-name">{part.name || "工具"}</span>
        {exit != null && exit !== 0 ? <span className="tool-exit bad">exit {exit}</span> : null}
        {running ? <span className="tool-exit run">运行中</span> : null}
        {part.durationMs ? <span className="tool-duration">{part.durationMs}ms</span> : null}
      </div>
      {part.input?.command ? <pre className="tool-command">{part.input.command}</pre> : null}
      {output ? (
        <details className="tool-output">
          <summary>输出</summary>
          <pre>{output}</pre>
        </details>
      ) : null}
      {diff ? (
        <details className="tool-output">
          <summary>差异</summary>
          <pre dangerouslySetInnerHTML={{ __html: highlightCode(diff, "diff") }} />
        </details>
      ) : null}
    </div>
  );
}

function messageText(message) {
  return message.parts
    .map((part) => {
      if (part.type === "text") return part.raw ?? part.text ?? "";
      if (part.type === "attachments") return (part.items || []).map((a) => a.name).join(" ");
      if (part.type === "tool") return [part.name, part.input?.command, part.output, part.diff].filter(Boolean).join(" ");
      return "";
    })
    .join(" ");
}

const MessageRow = React.memo(function MessageRow({ message, active, onEdit, onRetry }) {  if (message.role === "status") {
    return (
      <article className="entry status">
        <div className="entry-avatar">›</div>
        <div className="entry-body">{message.parts.map((p) => p.text).join("")}</div>
      </article>
    );
  }
  if (message.role === "tool") {
    return (
      <article className="entry tool">
        <div className="entry-avatar">›</div>
        <div className="entry-body">
          {message.parts.map((p, i) => (p.type === "tool" ? <ToolPart key={i} part={p} /> : null))}
        </div>
      </article>
    );
  }
  if (message.role === "reasoning") {
    const text = message.parts.map((p) => p.text || "").join("");
    if (!text.trim()) return null;
    return (
      <article className="entry reasoning">
        <details className="reasoning-card" open={active}>
          <summary>思考过程</summary>
          <div className="reasoning-body">{text}</div>
        </details>
      </article>
    );
  }
  const text = message.parts.filter((p) => p.type === "text").map((p) => p.raw ?? p.text ?? "").join("");
  const attachments = message.parts.find((p) => p.type === "attachments");
  return (
    <article className={`entry ${message.role}`}>
      <div className="entry-avatar">{message.role === "user" ? "U" : "C"}</div>
      <Markdown text={text} streaming={message.status === "streaming"} />
      {attachments ? (
        <div className="entry-gallery">
          {attachments.items.map((a, i) => (
            <img key={i} src={a.url} alt={a.name} loading="lazy" />
          ))}
        </div>
      ) : null}
      <MessageActions text={text} role={message.role} onEdit={onEdit} onRetry={onRetry} />
    </article>
  );
});

function StatusGroup({ notices }) {
  const [open, setOpen] = useState(false);
  if (!notices.length) return null;
  return (
    <article className="entry status status-group">
      <div className="entry-avatar">›</div>
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
      <div className="entry-tools" />
    </article>
  );
}

function ApprovalCard({ approval, onDecision }) {
  return (
    <section className="approval">
      <div>
        <strong>审批请求</strong>
        <pre>{JSON.stringify(approval.request?.params ?? approval.request, null, 2)}</pre>
      </div>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => onDecision(approval, "decline")}>
          拒绝
        </button>
        <button type="button" className="secondary" onClick={() => onDecision(approval, "always")}>
          始终允许
        </button>
        <button type="button" onClick={() => onDecision(approval, "accept")}>
          批准
        </button>
      </div>
    </section>
  );
}

function RunState({ run }) {
  const suffix = run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : "";
  return (
    <div id="runState" className="run-state" data-state={run.state} role="status" aria-live="polite">
      <span className="run-state-dot" aria-hidden="true" />
      <span id="runStateLabel">{`${run.label}${suffix}`}</span>
    </div>
  );
}

function ReviewDigest({ runState }) {
  const [digest, setDigest] = useState(null);
  useEffect(() => {
    if (runState !== "done") return undefined;
    let alive = true;
    api
      .review()
      .then((result) => {
        if (alive) setDigest(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [runState]);
  if (!digest || digest.notGitRepo || digest.clean) return null;
  const count = (digest.files || []).length;
  return (
    <article className="entry review-digest">
      <div className="entry-body">本轮改动 {count} 个文件（{digest.source || "working tree"}）</div>
    </article>
  );
}

function UsageBadge() {
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

function Conversation({ onDecision, onEdit, onRetry, children }) {
  const messages = useStoreSelector((s) => s.messages);
  const notices = useStoreSelector((s) => s.notices);
  const approvals = useStoreSelector((s) => s.approvals);
  const activeAssistantId = useStoreSelector((s) => s.activeAssistantId);
  const run = useStoreSelector((s) => s.run);
  const threadId = useStoreSelector((s) => s.meta.threadId);
  const logRef = useRef(null);
  const pinnedRef = useRef(true);
  const scrollSaveRef = useRef(null);
  const [showPill, setShowPill] = useState(false);
  const [query, setQuery] = useState("");

  const saveScrollDebounced = useCallback(
    (top) => {
      if (scrollSaveRef.current) clearTimeout(scrollSaveRef.current);
      scrollSaveRef.current = setTimeout(() => saveScroll(threadId, top), 300);
    },
    [threadId],
  );

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    pinnedRef.current = near;
    setShowPill(!near && el.scrollHeight - el.scrollTop - el.clientHeight > 160);
    saveScrollDebounced(el.scrollTop);
  }, [saveScrollDebounced]);

  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Restore per-thread scroll position when switching threads.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const saved = loadScroll(threadId);
    if (saved != null && saved > 0) {
      el.scrollTop = saved;
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    } else {
      el.scrollTop = el.scrollHeight;
      pinnedRef.current = true;
    }
    setShowPill(false);
  }, [threadId]);

  // Cache the conversation for offline relaunch (debounced).
  useEffect(() => {
    if (!threadId) return undefined;
    const handle = setTimeout(() => saveCachedMessages(threadId, messages), 800);
    return () => clearTimeout(handle);
  }, [messages, threadId]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? messages.filter((message) => messageText(message).toLowerCase().includes(needle)) : messages;
  const matchCount = needle ? visible.length : 0;

  return (
    <section className="conversation" aria-label="对话">
      <div className="message-search">
        <Search size={14} strokeWidth={1.9} aria-hidden="true" />
        <input
          id="messageSearch"
          type="search"
          placeholder="在会话中搜索…"
          aria-label="在会话中搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {needle ? <span className="message-search-count">{matchCount} 条</span> : null}
        {query ? (
          <button type="button" className="message-search-clear" aria-label="清除搜索" onClick={() => setQuery("")}>
            <X size={13} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div id="log" className="log" ref={logRef} onScroll={onScroll} aria-live="polite">
        <StatusGroup notices={notices} />
        {visible.map((message) => (
          <MessageRow key={message.id} message={message} active={message.id === activeAssistantId} onEdit={onEdit} onRetry={onRetry} />
        ))}
        <ReviewDigest runState={run.state} />
      </div>
      <UsageBadge />
      {approvals.map((approval) => (
        <ApprovalCard key={approval.approvalId} approval={approval} onDecision={onDecision} />
      ))}
      <RunState run={run} />
      {showPill ? (
        <button
          type="button"
          id="scrollPill"
          className="scroll-pill"
          aria-label="回到最新消息"
          onClick={() => {
            const el = logRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            pinnedRef.current = true;
            setShowPill(false);
          }}
        >
          ↓ 新消息
        </button>
      ) : null}
      {children}
    </section>
  );
}

function ModelMenu({ open, anchorRef, selectedModel, selectedReasoning, onReasoning, onModel, onMore, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event) => {
      const path = event.composedPath ? event.composedPath() : [];
      if (path.includes(anchorRef.current) || path.includes(ref.current)) return;
      onClose();
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, anchorRef, onClose]);

  return (
    <div ref={ref} id="modelMenu" className={`model-menu${open ? "" : " hidden"}`} role="menu" aria-label="模型与推理强度">
      <div className="model-menu-label">推理强度</div>
      {reasoningLevels.map((level) => (
        <button
          key={level}
          type="button"
          className={`model-menu-row${level === selectedReasoning ? " active" : ""}`}
          role="menuitemradio"
          aria-checked={level === selectedReasoning}
          onClick={() => onReasoning(level)}
        >
          {level}
          {level === selectedReasoning ? <span className="checkmark">✓</span> : null}
        </button>
      ))}
      <div className="model-menu-separator" />
      {modelChoices.map((model) => (
        <button
          key={model.id}
          type="button"
          className={`model-menu-row submenu-row${model.id === selectedModel ? " active" : ""}`}
          role="menuitemradio"
          aria-checked={model.id === selectedModel}
          onClick={() => onModel(model.id)}
        >
          {model.label}
          <span className="chevron">›</span>
        </button>
      ))}
      <button type="button" className="model-menu-row submenu-row" id="moreModelsButton" role="menuitem" onClick={onMore}>
        更多模型<span className="chevron">›</span>
      </button>
    </div>
  );
}

const Composer = React.memo(function Composer({
  ready,
  run,
  accessIndex,
  selectedModel,
  selectedReasoning,
  value,
  onChange,
  onSend,
  onInterrupt,
  onCycleAccess,
  onReasoning,
  onModel,
  onMoreModels,
  onExpand,
  promptRef,
}) {
  const text = value;
  const setText = onChange;
  const [menuOpen, setMenuOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [skills, setSkills] = useState([]);
  const [skillQuery, setSkillQuery] = useState(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const modelButtonRef = useRef(null);
  const fileRef = useRef(null);
  const skillsLoaded = useRef(false);
  const accessMode = accessModes[accessIndex];
  const modelLabel = selectedModel.replace(/^gpt-/i, "").toUpperCase();
  const running = ["running", "streaming", "approval", "interrupting"].includes(run.state);

  // Auto-grow the composer with its content (capped).
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, promptRef]);

  const slashMatch = useMemo(() => {
    const caret = text.length;
    const match = text.slice(0, caret).match(/(^|\s)([/／])([\p{L}\p{N}:_-]*)$/u);
    if (!match) return null;
    return { start: caret - match[3].length - match[2].length, end: caret, query: match[3].toLowerCase() };
  }, [text]);

  useEffect(() => {
    setSkillQuery(slashMatch);
    setSkillIndex(0);
    if (slashMatch && !skillsLoaded.current) {
      skillsLoaded.current = true;
      api
        .skills()
        .then((result) => setSkills(result.data || []))
        .catch(() => {});
    }
  }, [slashMatch]);

  const filteredSkills = useMemo(() => {
    if (!skillQuery) return [];
    const needle = skillQuery.query;
    return skills
      .filter((skill) => `${skill.trigger || ""} ${skill.name || ""} ${skill.id || ""} ${skill.pluginName || ""} ${skill.description || ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [skills, skillQuery]);

  const applySkill = (skill) => {
    if (!skillQuery) return;
    const command = skill.trigger || `/${skill.name || skill.id}`;
    setText(`${text.slice(0, skillQuery.start)}${command} `);
    setSkillQuery(null);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!ready) return;
    if (skillQuery && filteredSkills.length) {
      applySkill(filteredSkills[skillIndex]);
      return;
    }
    if (!text.trim() && !files.length) return;
    onSend({ text: text.trim(), files });
    setText("");
    setFiles([]);
  };

  const onKeyDown = (event) => {
    if (skillQuery && filteredSkills.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSkillIndex((i) => (i + 1) % filteredSkills.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSkillQuery(null);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        applySkill(filteredSkills[skillIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(event);
    }
  };

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) setText((value) => `${value}${value ? "\n" : ""}${transcript}`);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
  };

  const addFiles = async (list) => {
    const next = [];
    for (const file of list) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      next.push({ name: file.name, dataUrl });
    }
    setFiles((current) => current.concat(next));
  };

  return (
    <form id="composer" className="composer" onSubmit={submit}>
      <input
        ref={fileRef}
        id="fileInput"
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          addFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      {files.length ? (
        <div id="attachments" className="attachments">
          {files.map((f, i) => (
            <span key={i} className="attachment-chip">
              {f.name}
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        id="prompt"
        ref={promptRef}
        rows={2}
        placeholder="输入后续修改要求"
        aria-label="发消息给 Codex"
        enterKeyHint="send"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {skillQuery ? (
        <div id="slashSkillMenu" className="slash-skill-menu" role="listbox" aria-label="已安装技能">
          {filteredSkills.length ? (
            filteredSkills.map((skill, index) => (
              <button
                key={skill.id || skill.trigger}
                type="button"
                className="slash-skill-row"
                role="option"
                aria-selected={index === skillIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySkill(skill)}
              >
                <span className="slash-skill-command">{skill.trigger || `/${skill.name || skill.id}`}</span>
                <span className="slash-skill-copy">
                  <strong>{skill.name || skill.id}</strong>
                  <small>{skill.description || skill.pluginName || "installed skill"}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="slash-skill-empty">{skills.length ? "没有匹配的技能" : "尚未安装技能"}</div>
          )}
        </div>
      ) : null}
      <div className="composer-footer">
        <div className="composer-left">
          <button type="button" className="ghost-button icon-only" id="addButton" aria-label="添加图片" onClick={() => fileRef.current?.click()}>
            <Plus size={18} strokeWidth={1.9} />
          </button>
          <button type="button" className="ghost-button icon-only expand-button" id="expandPromptButton" title="放大输入框" aria-label="放大输入框" onClick={onExpand}>
            <Maximize2 size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button type="button" className="access-button" id="accessButton" onClick={onCycleAccess}>
            <span className="access-label">{accessMode.label}</span>
            <ChevronIcon className="button-chevron-icon" />
          </button>
        </div>
        <div className="composer-right">
          <button ref={modelButtonRef} type="button" id="modelButton" className="model-button" onClick={() => setMenuOpen((v) => !v)}>
            <span className="model-button-label">{`${modelLabel} ${selectedReasoning}`}</span>
            <ChevronIcon className="button-chevron-icon" />
          </button>
          <ModelMenu
            open={menuOpen}
            anchorRef={modelButtonRef}
            selectedModel={selectedModel}
            selectedReasoning={selectedReasoning}
            onReasoning={(level) => {
              onReasoning(level);
              setMenuOpen(false);
            }}
            onModel={(model) => {
              onModel(model);
              setMenuOpen(false);
            }}
            onMore={() => {
              setMenuOpen(false);
              onMoreModels();
            }}
            onClose={() => setMenuOpen(false)}
          />
          <button type="button" className={`voice-button${listening ? " listening" : ""}`} id="voiceButton" title="语音输入" aria-label="语音输入" onClick={startVoice}>
            <Mic size={18} strokeWidth={1.9} />
          </button>
          {running ? (
            <button type="button" className="interrupt-button" id="interruptRun" title="中断当前任务" aria-label="中断当前任务" onClick={onInterrupt}>
              <span className="interrupt-icon" aria-hidden="true" />
              <span className="interrupt-label">中断</span>
            </button>
          ) : null}
          <button id="send" type="submit" className="send-button" title="发送" aria-label="发送">
            <Send size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </form>
  );
});

function PromptModal({ open, value, onCancel, onApply }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, open]);
  if (!open) return null;
  return (
    <section className="prompt-modal" id="promptModal" role="dialog" aria-modal="true" aria-labelledby="promptModalTitle">
      <div className="prompt-modal-card">
        <header className="prompt-modal-header">
          <h2 id="promptModalTitle">编辑输入</h2>
          <button type="button" className="prompt-modal-close" id="closePromptModalButton" aria-label="关闭" onClick={() => onApply(draft)}>
            <X size={17} strokeWidth={2} />
          </button>
        </header>
        <textarea
          id="promptModalInput"
          className="prompt-modal-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入后续修改要求"
        />
        <footer className="prompt-modal-footer">
          <button type="button" className="secondary" id="cancelPromptModalButton" onClick={onCancel}>
            取消
          </button>
          <button type="button" id="applyPromptModalButton" onClick={() => onApply(draft)}>
            应用
          </button>
        </footer>
      </div>
    </section>
  );
}

function WorkspaceStrip({ meta }) {
  const hasMeta = Boolean(meta.repoName || meta.workspaceLocation || meta.gitBranch);
  return (
    <div id="workspaceIndicator" className={`workspace-strip${hasMeta ? "" : " empty"}`} aria-label="当前工作区">
      <div className="workspace-place">
        <span id="workspaceRepo" className="workspace-repo">
          {meta.repoName || "仓库"}
        </span>
        <span id="workspaceLocation" className="workspace-location">
          {compactWorkspaceLocation(meta.workspaceLocation || ".")}
        </span>
      </div>
      <div className="workspace-branch">
        <span className="branch-label">分支</span>
        <span id="branchName" className="branch-name">
          {meta.gitBranch || "未知"}
        </span>
      </div>
    </div>
  );
}

const Sidebar = React.memo(function Sidebar({ threads, selectedThread, search, onSearch, onSelect, onNew, onTool }) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((t) => `${titleForThread(t)} ${t.id}`.toLowerCase().includes(needle));
  }, [threads, search]);

  return (
    <>
      <button type="button" className="sidebar-scrim" id="sidebarScrim" aria-label="关闭会话列表" />
      <aside className="sidebar" id="threadSidebar" aria-label="会话">
        <div className="sidebar-windowbar" aria-label="Codex local bridge">
          <span className="window-dot red" aria-hidden="true" />
          <span className="window-dot yellow" aria-hidden="true" />
          <span className="window-dot green" aria-hidden="true" />
          <span className="window-spacer" aria-hidden="true" />
          <PanelLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          <ChevronLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <nav className="primary-nav" aria-label="主要操作">
          <button type="button" className="nav-command" id="newThread" onClick={onNew}>
            <span className="command-icon" aria-hidden="true">
              <Plus size={17} strokeWidth={1.9} />
            </span>
            <span>新会话</span>
          </button>
          <button type="button" className="nav-command muted" id="searchButton" onClick={onSearch}>
            <span className="command-icon" aria-hidden="true">
              <Search size={17} strokeWidth={1.9} />
            </span>
            <span>搜索</span>
          </button>
          <button type="button" className="nav-command muted" id="pluginsButton" onClick={() => onTool("plugins")}>
            <span className="command-icon" aria-hidden="true">
              <Box size={17} strokeWidth={1.9} />
            </span>
            <span>插件</span>
          </button>
          <button type="button" className="nav-command muted" id="automationsButton" onClick={() => onTool("automations")}>
            <span className="command-icon" aria-hidden="true">
              <Workflow size={17} strokeWidth={1.9} />
            </span>
            <span>自动化</span>
          </button>
        </nav>
        <div className="thread-section">
          <div className="section-title">最近的会话</div>
          <input id="threadSearch" className="thread-search" type="search" placeholder="搜索会话" aria-label="搜索会话" value={search} onChange={(e) => onSearch(e.target.value)} />
          <div id="threadList" className="thread-list">
            <button type="button" className="project-heading new-project" onClick={onNew}>
              New Codex thread
            </button>
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
          </div>
        </div>
        <button type="button" className="settings" id="settingsButton" aria-label="显示设置" onClick={() => onTool("settings")}>
          <span className="command-icon" aria-hidden="true">
            <Settings size={17} strokeWidth={1.9} />
          </span>
          <span>设置</span>
        </button>
      </aside>
    </>
  );
});

export function App() {
  const { ready, run, meta, provider } = useStoreSelector((s) => ({
    ready: s.ready,
    run: s.run,
    meta: s.meta,
    provider: s.provider,
  }));
  const promptRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("codexPhoneTheme") || "simple");
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(initialThread);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState("artifacts");
  const [toolView, setToolView] = useState(null);
  const [search, setSearch] = useState("");
  const [accessIndex, setAccessIndex] = useState(() => {
    const saved = localStorage.getItem("codexPhoneAccess");
    const idx = accessModes.findIndex((m) => m.label === saved);
    return idx >= 0 ? idx : 0;
  });
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("codexPhoneModel") || "gpt-6.1-sol");
  const [selectedReasoning, setSelectedReasoning] = useState(() => localStorage.getItem("codexPhoneReasoning") || "中");
  const [modalOpen, setModalOpen] = useState(false);
  const [artifacts, setArtifacts] = useState([]);
  const [promptText, setPromptText] = useState("");

  // composer metrics for scroll-pill placement + keyboard inset fallback
  useEffect(() => {
    const root = document.documentElement;
    const stack = document.querySelector(".composer-stack");
    let observer;
    if (stack) {
      const sync = () => root.style.setProperty("--composer-height", `${Math.round(stack.offsetHeight)}px`);
      sync();
      if ("ResizeObserver" in window) {
        observer = new ResizeObserver(sync);
        observer.observe(stack);
      }
    }
    const vv = window.visualViewport;
    const applyInset = () => {
      if (!vv) return;
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    applyInset();
    if (vv) {
      vv.addEventListener("resize", applyInset);
      vv.addEventListener("scroll", applyInset);
    }
    return () => {
      if (observer) observer.disconnect();
      if (vv) {
        vv.removeEventListener("resize", applyInset);
        vv.removeEventListener("scroll", applyInset);
      }
    };
  }, []);

  // keep the screen awake while a run is active
  useEffect(() => {
    const running = ["running", "streaming", "approval", "interrupting"].includes(run.state);
    if (!running || !("wakeLock" in navigator)) return undefined;
    let lock = null;
    let released = false;
    navigator.wakeLock
      .request("screen")
      .then((handle) => {
        if (released) handle.release();
        else lock = handle;
      })
      .catch(() => {});
    return () => {
      released = true;
      try {
        lock && lock.release();
      } catch {
        /* ignore */
      }
    };
  }, [run.state]);

  // theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("codexPhoneTheme", theme);
  }, [theme]);

  // remember the active thread so relaunching the app returns to it
  useEffect(() => {
    if (!meta.threadId) return;
    try {
      localStorage.setItem("codexPhoneThread", meta.threadId);
    } catch {
      /* ignore */
    }
  }, [meta.threadId]);

  // body classes for CSS-driven layout
  useEffect(() => {
    document.body.classList.toggle("show-sidebar", sidebarOpen);
  }, [sidebarOpen]);
  useEffect(() => {
    const open = panelOpen || toolView != null;
    document.body.classList.toggle("hide-artifacts", !open);
    document.body.classList.toggle("show-panel", open);
  }, [panelOpen, toolView]);

  const loadThreads = useCallback(async () => {
    try {
      const result = await api.threads(provider || "codex");
      setThreads(result.data || result.threads || []);
    } catch {
      /* ignore background errors */
    }
  }, [provider]);

  const loadArtifacts = useCallback(async () => {
    try {
      const result = await api.artifacts();
      setArtifacts(result.data || result.artifacts || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    api.info().catch(() => {});
    loadThreads();
    loadArtifacts();
    // Paint the last cached conversation immediately (also works offline).
    const cached = loadCachedMessages(initialThread);
    if (cached && cached.length) {
      store.dispatch({ type: "messages.restore", threadId: initialThread, messages: cached });
    }
    connection.connect(initialThread);
    return () => connection.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(loadThreads, 12000);
    return () => clearInterval(timer);
  }, [loadThreads]);

  const selectThread = useCallback(
    (threadId) => {
      setSelectedThread(threadId);
      setSidebarOpen(false);
      connection.setThread(threadId);
      loadThreads();
    },
    [loadThreads],
  );

  const sendPrompt = useCallback(
    (payload) => {
      // connection.send queues while offline and flushes on reconnect.
      connection.send({
        type: "prompt",
        text: payload.text || (payload.files.length ? "请查看附件图片。" : ""),
        attachments: payload.files,
        options: {
          model: selectedModel || undefined,
          effort: reasoningEffortValue(selectedReasoning),
          approvalPolicy: accessModes[accessIndex].approvalPolicy,
          sandboxMode: accessModes[accessIndex].sandboxMode,
        },
      });
    },
    [accessIndex, selectedModel, selectedReasoning],
  );

  const decide = useCallback((approval, action) => {
    const always = action === "always";
    const decision = action === "decline" ? "decline" : "accept";
    connection.send({ type: "approval", request: approval.request, decision, always });
    store.dispatch({ type: "approval.resolved", approvalId: approval.approvalId });
  }, []);

  const cycleAccess = useCallback(() => {
    setAccessIndex((current) => {
      const next = (current + 1) % accessModes.length;
      localStorage.setItem("codexPhoneAccess", accessModes[next].label);
      return next;
    });
  }, []);

  const handleSearch = useCallback((value) => {
    if (typeof value === "string") setSearch(value);
  }, []);
  const newThread = useCallback(() => selectThread(""), [selectThread]);
  const openTool = useCallback((tool) => {
    setSidebarOpen(false);
    setPanelOpen(true);
    setActivePanel(tool);
    setToolView(tool);
  }, []);
  const handleTab = useCallback((tab) => {
    setActivePanel(tab);
    setToolView(null);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setToolView(null);
  }, []);
  const appendToPrompt = useCallback((text) => {
    setPromptText((value) => `${value}${value ? "\n" : ""}${text}`);
    promptRef.current?.focus();
  }, []);
  const selectModel = useCallback((model) => {
    setSelectedModel(model);
    localStorage.setItem("codexPhoneModel", model);
  }, []);
  const changeReasoning = useCallback((level) => {
    setSelectedReasoning(level);
    localStorage.setItem("codexPhoneReasoning", level);
  }, []);
  const moreModels = useCallback(() => {
    setPanelOpen(true);
    setActivePanel("models");
    setToolView("models");
  }, []);
  const interrupt = useCallback(() => connection.send({ type: "interrupt" }), []);
  const openModal = useCallback(() => setModalOpen(true), []);
  const retryPrompt = useCallback((text) => sendPrompt({ text, files: [] }), [sendPrompt]);
  const editPrompt = useCallback((text) => {
    setPromptText(text);
    promptRef.current?.focus();
  }, []);

  return (
    <main className="app-shell">
      <Sidebar
        threads={threads}
        selectedThread={selectedThread}
        search={search}
        onSearch={handleSearch}
        onSelect={selectThread}
        onNew={newThread}
        onTool={openTool}
      />
      <section className="workspace">
        <header className="titlebar">
          <button type="button" className="mobile-toggle" id="mobileThreads" aria-controls="threadSidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
            会话
          </button>
          <div className="title-stack">
            <h1 id="threadTitle">{threads.find((t) => t.id === selectedThread) ? titleForThread(threads.find((t) => t.id === selectedThread)) : "Codex Remote"}</h1>
            <p id="meta">{runStateText[run.state] || run.label}</p>
          </div>
          <div className="title-actions">
            <button id="connect" type="button" className="icon-button" title="重新连接" aria-label="重新连接" onClick={() => connection.connect(selectedThread)}>
              <RefreshCw size={16} strokeWidth={1.9} />
            </button>
            <button type="button" className="icon-button" id="menuButton" title="打开/关闭右侧面板" aria-label="打开/关闭右侧面板" onClick={() => setPanelOpen((v) => !v)}>
              <MoreHorizontal size={18} strokeWidth={2} />
            </button>
          </div>
        </header>
        <div className="content-grid">
          <Conversation onDecision={decide} onEdit={editPrompt} onRetry={retryPrompt}>
            <div className="composer-stack">
              <Composer
                ready={ready}
                run={run}
                accessIndex={accessIndex}
                selectedModel={selectedModel}
                selectedReasoning={selectedReasoning}
                value={promptText}
                onChange={setPromptText}
                promptRef={promptRef}
                onSend={sendPrompt}
                onInterrupt={interrupt}
                onCycleAccess={cycleAccess}
                onReasoning={changeReasoning}
                onModel={selectModel}
                onMoreModels={moreModels}
                onExpand={openModal}
              />
              <WorkspaceStrip meta={meta} />
            </div>
            <PromptModal
              open={modalOpen}
              value={promptText}
              onCancel={() => setModalOpen(false)}
              onApply={(value) => {
                setPromptText(value);
                setModalOpen(false);
              }}
            />
          </Conversation>
          <Panels
            open={panelOpen}
            activePanel={activePanel}
            toolView={toolView}
            onTab={handleTab}
            onClose={closePanel}
            artifacts={artifacts}
            appendToPrompt={appendToPrompt}
            onSelectModel={selectModel}
            theme={theme}
            onTheme={setTheme}
          />
        </div>
      </section>
    </main>
  );
}
