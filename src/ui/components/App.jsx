import React, { useCallback, useEffect, useRef, useState } from "react";
import { TopAppBar } from "./TopAppBar.jsx";
import { ThreadDrawer } from "./ThreadDrawer.jsx";
import { MessageList, UsageBadge } from "./MessageList.jsx";
import { Composer } from "./Composer.jsx";
import { ModelSheet } from "./ModelSheet.jsx";
import { PanelsSheet } from "./PanelsSheet.jsx";
import { MessageActionSheet } from "./MessageActionSheet.jsx";
import { PromptDialog } from "./PromptDialog.jsx";
import { ApprovalCard } from "./ApprovalCard.jsx";
import { WorkspaceStrip } from "./WorkspaceStrip.jsx";
import { useStoreSelector, store, connection } from "./store.jsx";
import { api, initialThread } from "../lib/api.js";
import { loadCachedMessages } from "../lib/cache.js";
import { loadDraft, saveDraft } from "../lib/drafts.js";
import { runStateText } from "../lib/store.js";
import { accessModes, reasoningEffortValue } from "../lib/constants.js";
import { applyTheme, loadPref, watchSystemTheme } from "../lib/theme.js";
import { tap } from "../lib/haptic.js";

function titleForThread(thread) {
  return thread?.name || thread?.title || thread?.preview || thread?.id || "会话";
}

export function App() {
  const { ready, run, meta, provider, approvals, commands } = useStoreSelector((s) => ({
    ready: s.ready,
    run: s.run,
    meta: s.meta,
    provider: s.provider,
    approvals: s.approvals,
    commands: s.commands,
  }));

  const promptRef = useRef(null);
  const [theme, setTheme] = useState(loadPref);
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(initialThread);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchState, setSearchState] = useState({ open: false, query: "" });
  const [searchCount, setSearchCount] = useState(0);
  const [sheet, setSheet] = useState(null); // null | "models" | "panels" | "actions"
  const [activePanel, setActivePanel] = useState("artifacts");
  const [toolView, setToolView] = useState(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [artifacts, setArtifacts] = useState([]);
  const [promptText, setPromptText] = useState(() => loadDraft("codex", initialThread || ""));
  const [accessIndex, setAccessIndex] = useState(() => {
    const saved = localStorage.getItem("codexPhoneAccess");
    const idx = accessModes.findIndex((m) => m.label === saved);
    return idx >= 0 ? idx : 0;
  });
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("codexPhoneModel") || "gpt-6.1-sol");
  const [selectedReasoning, setSelectedReasoning] = useState(() => localStorage.getItem("codexPhoneReasoning") || "中");
  const [caps, setCaps] = useState(null);

  // Per provider+thread draft persistence. Typing is never lost when the user
  // switches sessions or the page reloads; a draft is scoped to its session so
  // it can never be sent to a different thread.
  const promptTextRef = useRef(promptText);
  promptTextRef.current = promptText;
  const draftKeyRef = useRef({ provider, threadId: meta.threadId });
  useEffect(() => {
    const prev = draftKeyRef.current;
    const next = { provider, threadId: meta.threadId };
    if (prev.provider === next.provider && prev.threadId === next.threadId) return;
    const text = promptTextRef.current;
    saveDraft(prev.provider, prev.threadId, text);
    // When a "new" session gets its authoritative thread id, migrate the draft
    // instead of loading an empty one and wiping what the user just typed.
    const migratingNew = !prev.threadId && Boolean(next.threadId);
    draftKeyRef.current = next;
    if (migratingNew) saveDraft(next.provider, next.threadId, text);
    else setPromptText(loadDraft(next.provider, next.threadId));
  }, [provider, meta.threadId]);

  const handlePromptChange = useCallback(
    (value) => {
      setPromptText(value);
      saveDraft(draftKeyRef.current.provider, draftKeyRef.current.threadId, value);
    },
    [],
  );

  const restoreCommand = useCallback((command) => {
    const text = command.text || "";
    setPromptText((current) => {
      const merged = !current.trim() ? text : current.includes(text) ? current : `${current}\n${text}`;
      saveDraft(draftKeyRef.current.provider, draftKeyRef.current.threadId, merged);
      return merged;
    });
    store.dispatch({ type: "command.dismiss", commandId: command.commandId });
    promptRef.current?.focus();
  }, []);

  // theme apply + follow system
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => {});
  }, [theme]);

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

  // composer metrics for scroll-fab / usage badge placement + keyboard inset
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

  // remember the active thread
  useEffect(() => {
    if (!meta.threadId) return;
    try {
      localStorage.setItem("codexPhoneThread", meta.threadId);
    } catch {
      /* ignore */
    }
  }, [meta.threadId]);

  const adoptedThreadRef = useRef(meta.threadId);
  useEffect(() => {
    if (meta.threadId && meta.threadId !== adoptedThreadRef.current) {
      adoptedThreadRef.current = meta.threadId;
      setSelectedThread(meta.threadId);
    }
  }, [meta.threadId]);

  const loadThreads = useCallback(async () => {
    try {
      const result = await api.threads(provider || "codex");
      setThreads(result.data || result.threads || []);
    } catch {
      /* ignore */
    }
  }, [provider]);

  // The authoritative provider decides which thread source to read; reload the
  // drawer list whenever readiness or the provider changes.
  useEffect(() => {
    if (!ready) return;
    loadThreads();
  }, [ready, provider, loadThreads]);

  // Expired model check: a saved model that vanished from the provider's real
  // directory must be surfaced ("请重新选择"), never silently sent.
  const modelValidityRef = useRef(false);
  useEffect(() => {
    if (modelValidityRef.current) return;
    if (provider !== "codex") return;
    let cancelled = false;
    api
      .models()
      .then((result) => {
        if (cancelled || modelValidityRef.current) return;
        const list = result.data || [];
        if (!list.length) return;
        modelValidityRef.current = true;
        const ids = new Set(list.map((c) => c.model || c.id).filter(Boolean));
        if (selectedModel && !ids.has(selectedModel)) {
          store.dispatch({
            type: "status",
            text: `模型 ${selectedModel} 不在当前目录中，请在模型列表重新选择`,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [provider, selectedModel]);

  const loadArtifacts = useCallback(async () => {
    try {
      const result = await api.artifacts();
      setArtifacts(result.data || result.artifacts || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedEntry = loadCachedMessages(initialThread);
    const cached = cachedEntry?.messages || [];
    if (cached.length) {
      store.dispatch({ type: "messages.restore", threadId: initialThread, messages: cached });
    }
    // Exchange the URL token for a session cookie before opening the socket, so
    // the token can be stripped from the address bar right away.
    api
      .auth()
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        api
          .info()
          .then((info) => {
            if (!cancelled) setCaps(info.capabilities || null);
          })
          .catch(() => {});
        loadThreads();
        loadArtifacts();
        connection.connect(initialThread);
      });
    return () => {
      cancelled = true;
      connection.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(loadThreads, 12000);
    return () => clearInterval(timer);
  }, [loadThreads]);

  const selectThread = useCallback(
    (threadId) => {
      setSelectedThread(threadId);
      setDrawerOpen(false);
      connection.setThread(threadId);
      loadThreads();
    },
    [loadThreads],
  );

  const sendPrompt = useCallback(
    (payload) => {
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
    tap();
    const always = action === "always";
    const decision = action === "decline" ? "decline" : "accept";
    // The card stays visible in a "submitting" state until the server's own
    // approval.resolved arrives; a rejected submit command flips it to failed.
    const commandId = connection.send({ type: "approval", request: approval.request, decision, always });
    store.dispatch({ type: "approval.submitting", approvalId: approval.approvalId, commandId });
  }, []);

  const cycleAccess = useCallback(() => {
    tap();
    setAccessIndex((current) => {
      const next = (current + 1) % accessModes.length;
      localStorage.setItem("codexPhoneAccess", accessModes[next].label);
      return next;
    });
  }, []);

  const newThread = useCallback(() => selectThread(""), [selectThread]);
  const openTool = useCallback((tool) => {
    setDrawerOpen(false);
    setToolView(tool);
    setSheet("panels");
  }, []);
  const openPanels = useCallback(() => {
    setToolView(null);
    setSheet("panels");
  }, []);
  const handleTab = useCallback((tab) => {
    setToolView(null);
    setActivePanel(tab);
  }, []);
  const appendToPrompt = useCallback(
    (text) => {
      const next = `${promptTextRef.current}${promptTextRef.current ? "\n" : ""}${text}`;
      handlePromptChange(next);
      promptRef.current?.focus();
    },
    [handlePromptChange],
  );
  const selectModel = useCallback((model) => {
    setSelectedModel(model);
    localStorage.setItem("codexPhoneModel", model);
    setSheet(null);
  }, []);
  const changeReasoning = useCallback((level) => {
    setSelectedReasoning(level);
    localStorage.setItem("codexPhoneReasoning", level);
  }, []);
  const moreModels = useCallback(() => {
    setToolView("models");
    setSheet("panels");
  }, []);
  const interrupt = useCallback(() => {
    tap();
    connection.send({ type: "interrupt" });
  }, []);
  const retryPrompt = useCallback((text) => sendPrompt({ text, files: [] }), [sendPrompt]);
  const editPrompt = useCallback(
    (text) => {
      handlePromptChange(text);
      promptRef.current?.focus();
    },
    [handlePromptChange],
  );

  const onSearchChange = useCallback((value) => {
    setSearchState((s) => ({ ...s, query: value }));
  }, []);

  const selectedThreadTitle = threads.find((t) => t.id === selectedThread);
  const statusLabel = runStateText[run.state] || run.label;

  return (
    <main className="app-shell">
      <div className="ambient" aria-hidden="true" />
      <section className="workspace">
        <TopAppBar
          title={selectedThreadTitle ? titleForThread(selectedThreadTitle) : "Codex Remote"}
          status={statusLabel}
          scrolled={scrolled}
          searching={searchState.open}
          searchQuery={searchState.query}
          searchCount={searchCount}
          onOpenDrawer={() => setDrawerOpen(true)}
          onToggleSearch={() => setSearchState((s) => ({ open: !s.open, query: "" }))}
          onSearchChange={onSearchChange}
          onReconnect={() => connection.reconnect()}
          onMenu={openPanels}
          connecting={!ready && run.state !== "ready"}
        />
        <div className="content-grid">
          <div className="conversation">
            <MessageList
              runState={run.state}
              searchQuery={searchState.query}
              onCount={setSearchCount}
              onScrollToggle={setScrolled}
              onLongPress={(message) => {
                setActionMessage(message);
                setSheet("actions");
              }}
            />
            <UsageBadge />
            {approvals.map((approval) => (
              <ApprovalCard
                key={approval.approvalId}
                approval={approval}
                onDecision={decide}
                allowAlways={caps ? caps.sessionApprovalAlways !== false : (meta.provider || provider) === "codex"}
              />
            ))}
            <div className="composer-stack">
              <Composer
                ready={ready}
                run={run}
                accessIndex={accessIndex}
                selectedModel={selectedModel}
                selectedReasoning={selectedReasoning}
                value={promptText}
                onChange={handlePromptChange}
                commands={commands}
                onRestoreCommand={restoreCommand}
                promptRef={promptRef}
                onSend={sendPrompt}
                onInterrupt={interrupt}
                onCycleAccess={cycleAccess}
                onOpenModels={() => setSheet("models")}
                onExpand={() => setModalOpen(true)}
              />
              <WorkspaceStrip meta={meta} />
            </div>
          </div>
        </div>
      </section>

      <ThreadDrawer
        open={drawerOpen}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        threads={threads}
        selectedThread={selectedThread}
        search={threadSearch}
        onSearch={setThreadSearch}
        onSelect={selectThread}
        onNew={newThread}
        onTool={openTool}
      />

      <ModelSheet
        open={sheet === "models"}
        onClose={() => setSheet(null)}
        selectedModel={selectedModel}
        selectedReasoning={selectedReasoning}
        onReasoning={changeReasoning}
        onModel={selectModel}
        onMore={moreModels}
      />

      <PanelsSheet
        open={sheet === "panels"}
        activePanel={activePanel}
        toolView={toolView}
        onTab={handleTab}
        onClose={() => setSheet(null)}
        artifacts={artifacts}
        appendToPrompt={appendToPrompt}
        onSelectModel={selectModel}
        theme={theme}
        onTheme={setTheme}
      />

      <MessageActionSheet
        open={sheet === "actions"}
        onClose={() => setSheet(null)}
        message={actionMessage}
        onEdit={editPrompt}
        onRetry={retryPrompt}
      />

      <PromptDialog
        open={modalOpen}
        value={promptText}
        onCancel={() => setModalOpen(false)}
        onApply={(value) => {
          handlePromptChange(value);
          setModalOpen(false);
        }}
      />
    </main>
  );
}
