// Client-side domain store: normalized events -> renderable state.
// Framework-agnostic; React consumes it via useSyncExternalStore.

import { stripUiDirectives } from "./markdown.js";

const MAX_NOTICES = 60;

export const runStateText = {
  connecting: "连接中",
  ready: "空闲",
  submitted: "已发送",
  running: "Codex 处理中",
  streaming: "正在生成回答",
  reconnecting: "重新连接中",
  approval: "等待审批",
  interrupting: "正在中断",
  interrupted: "已中断",
  syncing: "历史同步中",
  done: "完成",
  disconnected: "已断开",
  error: "错误",
};

export function toolName(tool) {
  if (!tool) return "工具";
  if (tool.name) return tool.name;
  if (tool.kind === "command") return tool.command || "命令";
  if (tool.kind === "fileChange") return "文件改动";
  return tool.kind || "工具";
}

function attachmentsPart(attachments) {
  return Array.isArray(attachments) && attachments.length ? [{ type: "attachments", items: attachments }] : [];
}

export function messageFromHistory(entry, index) {
  const id = `hist:${index}`;
  if (entry.type === "user") {
    return {
      id,
      role: "user",
      status: "done",
      parts: [{ type: "text", text: entry.text || "" }, ...attachmentsPart(entry.attachments)],
    };
  }
  if (entry.type === "assistant") {
    return { id, role: "assistant", status: "done", phase: entry.phase || null, parts: [{ type: "text", text: entry.text || "" }] };
  }
  if (entry.type === "status" && entry.tool) {
    return { id, role: "tool", status: "done", parts: [{ type: "tool", ...entry.tool, name: toolName(entry.tool) }] };
  }
  return { id, role: "status", status: "done", parts: [{ type: "text", text: entry.text || "" }] };
}

export function initialState() {
  return {
    seq: 0,
    ready: false,
    connection: "connecting",
    meta: { provider: "codex", threadId: "", model: "", workdir: "", repoName: "", workspaceLocation: "", gitBranch: "" },
    run: { state: "connecting", label: "连接中", turnId: null },
    messages: [],
    activeAssistantId: null,
    notices: [],
    approvals: [],
    usage: null,
    provider: "codex",
  };
}

// Update a single message immutably (only its parts get cloned) so unchanged
// messages keep referential identity and memoized rows skip re-rendering.
function patchMessage(messages, id, role, updater) {
  const index = messages.findIndex((m) => m.id === id);
  if (index < 0) {
    const created = { id, role, status: "streaming", parts: [] };
    updater(created);
    return [...messages, created];
  }
  const current = messages[index];
  const copy = { ...current, parts: current.parts.map((p) => ({ ...p })) };
  updater(copy);
  const next = messages.slice();
  next[index] = copy;
  return next;
}

function appendTextPart(message, delta) {
  const last = message.parts[message.parts.length - 1];
  if (last && last.type === "text") {
    last.text = `${last.text}${delta}`;
    last.raw = `${last.raw ?? last.text}${delta}`;
  } else {
    message.parts.push({ type: "text", text: delta, raw: delta });
  }
}

function setTextPart(message, text) {
  const raw = stripUiDirectives(text || "");
  const last = [...message.parts].reverse().find((p) => p.type === "text");
  if (last) {
    last.text = raw;
    last.raw = raw;
  } else {
    message.parts.push({ type: "text", text: raw, raw });
  }
}

export function applyEvent(state, event) {
  if (!event || typeof event.type !== "string") return state;
  if (typeof event.seq === "number" && event.seq <= state.seq && !["history.snapshot", "ready"].includes(event.type)) {
    return state;
  }
  const next = { ...state };
  if (typeof event.seq === "number") next.seq = Math.max(next.seq, event.seq);

  switch (event.type) {
    case "history.snapshot": {
      const messages = (event.messages || []).map(messageFromHistory);
      next.messages = messages;
      next.activeAssistantId = null;
      next.approvals = [];
      if (typeof event.seq === "number") next.seq = event.seq;
      if (event.threadId) next.meta = { ...next.meta, threadId: event.threadId };
      if (event.run) next.run = event.run;
      return next;
    }
    case "messages.restore": {
      // Cached renderable messages (already in {role, parts} form).
      next.messages = (event.messages || []).map((m) => ({ ...m, parts: (m.parts || []).map((p) => ({ ...p })) }));
      next.activeAssistantId = null;
      if (event.threadId) next.meta = { ...next.meta, threadId: event.threadId };
      return next;
    }
    case "ready": {
      next.ready = true;
      next.connection = "open";
      next.meta = {
        provider: event.provider || next.meta.provider,
        threadId: event.threadId || next.meta.threadId,
        model: event.model || next.meta.model,
        workdir: event.workdir || next.meta.workdir,
        repoName: event.repoName || "",
        workspaceLocation: event.workspaceLocation || "",
        gitBranch: event.gitBranch || event.branch || "",
      };
      if (event.run) next.run = event.run;
      return next;
    }
    case "run.state": {
      next.run = { state: event.state || next.run.state, label: event.label || runStateText[event.state] || next.run.state, turnId: event.turnId ?? next.run.turnId };
      return next;
    }
    case "run.started":
      next.run = { state: "running", label: runStateText.running, turnId: event.turnId || null };
      return next;
    case "run.finished":
      next.run = {
        state: event.status === "interrupted" ? "interrupted" : "done",
        label: event.status === "interrupted" ? runStateText.interrupted : runStateText.done,
        turnId: event.turnId || null,
        durationMs: event.durationMs ?? null,
      };
      next.activeAssistantId = null;
      return next;
    case "usage.updated":
      next.usage = { total: event.total || null, last: event.last || null };
      return next;
    case "run.error":
      next.run = { state: "error", label: event.message || runStateText.error, turnId: next.run.turnId };
      next.notices = [...next.notices, { id: `err:${next.seq}`, kind: "error", text: event.message || "错误" }].slice(-MAX_NOTICES);
      return next;
    case "message.started": {
      const role = event.role || "assistant";
      next.messages = patchMessage(next.messages, event.messageId, role, (message) => {
        message.role = role;
        message.status = "streaming";
        if (event.phase) message.phase = event.phase;
      });
      if (role === "assistant") next.activeAssistantId = event.messageId;
      return next;
    }
    case "message.delta": {
      next.messages = patchMessage(next.messages, event.messageId, "assistant", (message) => {
        message.status = "streaming";
        appendTextPart(message, event.delta || "");
      });
      const active = next.messages.find((m) => m.id === event.messageId);
      if (active && active.role === "assistant") next.activeAssistantId = event.messageId;
      return next;
    }
    case "message.finished": {
      next.messages = patchMessage(next.messages, event.messageId, event.role || "assistant", (message) => {
        if (event.role) message.role = event.role;
        if (typeof event.text === "string") setTextPart(message, event.text);
        if (Array.isArray(event.attachments) && event.attachments.length) message.parts.push(...attachmentsPart(event.attachments));
        if (event.phase) message.phase = event.phase;
        message.status = "done";
      });
      if (next.activeAssistantId === event.messageId) next.activeAssistantId = null;
      return next;
    }
    case "reasoning.started": {
      next.messages = patchMessage(next.messages, event.messageId, "reasoning", (message) => {
        message.role = "reasoning";
        message.status = "streaming";
      });
      return next;
    }
    case "reasoning.delta": {
      next.messages = patchMessage(next.messages, event.messageId, "reasoning", (message) => {
        appendTextPart(message, event.delta || "");
      });
      return next;
    }
    case "reasoning.finished": {
      next.messages = patchMessage(next.messages, event.messageId, "reasoning", (message) => {
        if (typeof event.text === "string" && event.text) setTextPart(message, event.text);
        message.status = "done";
      });
      return next;
    }
    case "tool.started": {
      next.messages = patchMessage(next.messages, `tool:${event.toolCallId}`, "tool", (message) => {
        message.role = "tool";
        message.status = "streaming";
        message.parts = [
          {
            type: "tool",
            toolCallId: event.toolCallId,
            kind: event.kind,
            name: event.name || toolName(event),
            input: event.input || {},
            status: "running",
          },
        ];
      });
      return next;
    }
    case "tool.finished": {
      next.messages = patchMessage(next.messages, `tool:${event.toolCallId}`, "tool", (message) => {
        if (!message.parts.length) {
          message.parts = [{ type: "tool", toolCallId: event.toolCallId, kind: event.kind, name: toolName(event) }];
        }
        const part = message.parts.find((p) => p.type === "tool");
        Object.assign(part, {
          status: event.status || "completed",
          output: event.output ?? part.output ?? "",
          exitCode: event.exitCode ?? part.exitCode ?? null,
          durationMs: event.durationMs ?? part.durationMs ?? null,
          diff: event.diff ?? part.diff ?? "",
        });
        message.status = "done";
      });
      return next;
    }
    case "approval.requested": {
      const approval = { approvalId: event.approvalId, request: event.request };
      next.approvals = [...next.approvals, approval];
      next.run = { state: "approval", label: runStateText.approval, turnId: next.run.turnId };
      return next;
    }
    case "approval.resolved": {
      next.approvals = next.approvals.filter((a) => a.approvalId !== event.approvalId);
      return next;
    }
    case "status": {
      if (!event.text) return next;
      next.notices = [...next.notices, { id: `st:${next.seq}:${event.text.slice(0, 12)}`, kind: "status", text: event.text }].slice(-MAX_NOTICES);
      return next;
    }
    case "error": {
      const text = event.text || event.message || "错误";
      next.notices = [...next.notices, { id: `e:${next.seq}`, kind: "error", text }].slice(-MAX_NOTICES);
      return next;
    }
    case "runState": {
      const state2 = event.state || (event.run && event.run.state);
      if (!state2) return next;
      next.run = { state: state2, label: event.label || (event.run && event.run.label) || runStateText[state2] || state2, turnId: event.turnId ?? next.run.turnId };
      return next;
    }
    case "connection": {
      next.connection = event.status;
      if (event.status === "closed") {
        next.ready = false;
        next.run = { ...next.run, state: "reconnecting", label: runStateText.reconnecting };
      }
      return next;
    }
    default:
      return state;
  }
}

export function createStore() {
  let state = initialState();
  const listeners = new Set();
  const store = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(event) {
      const next = applyEvent(state, event);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    replace(next) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
  return store;
}
