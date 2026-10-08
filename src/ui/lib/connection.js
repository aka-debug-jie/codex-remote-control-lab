// WebSocket connection manager: reconnect w/ backoff, heartbeat, gap resync,
// and rAF-coalesced streaming deltas.

import { getToken, isCookieReady } from "./api.js";

export function createConnection(store, { onThreadChange } = {}) {
  let ws = null;
  let threadId = "";
  let attempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastPong = 0;
  let manualClose = false;
  let lastSeq = 0;
  let deltaBuffer = new Map();
  let flushHandle = null;
  const outbox = [];
  const pendingCommands = new Map();
  const COMMAND_TYPES = new Set(["prompt", "interrupt", "approval"]);

  function makeCommandId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function wire(payload) {
    // Only attach the raw token while cookie auth is not yet active; once the
    // session cookie exists the socket is authenticated at upgrade time.
    if (!isCookieReady() && getToken()) return JSON.stringify({ token: getToken(), ...payload });
    return JSON.stringify(payload);
  }

  function send(payload) {
    const open = ws && ws.readyState === WebSocket.OPEN;
    if (COMMAND_TYPES.has(payload.type)) {
      if (!payload.commandId) payload = { ...payload, commandId: makeCommandId() };
      // Keep until the server ACKs, so a command is never lost on a drop and is
      // re-sent (server dedupes by commandId) if the ACK never arrived.
      pendingCommands.set(payload.commandId, payload);
      store.dispatch({
        type: "command.sent",
        commandId: payload.commandId,
        status: open ? "awaitingAck" : "queued",
        text: payload.text || "",
        attachments: payload.attachments || [],
      });
      if (open) ws.send(wire(payload));
      return payload.commandId;
    }
    if (open) {
      ws.send(wire(payload));
    } else {
      outbox.push(payload);
    }
    return null;
  }

  function flushDeltas() {
    flushHandle = null;
    if (!deltaBuffer.size) return;
    const entries = [...deltaBuffer.entries()];
    deltaBuffer = new Map();
    for (const [messageId, delta] of entries) {
      store.dispatch({ type: "message.delta", messageId, delta });
    }
  }

  function scheduleFlush() {
    if (flushHandle != null) return;
    flushHandle = requestAnimationFrame(flushDeltas);
  }

  function handleEvent(event) {
    if (!event || typeof event.type !== "string") return;
    if (event.type === "pong") {
      lastPong = Date.now();
      return;
    }
    if (event.type === "threadUpdated") {
      send({ type: "resync" });
      return;
    }
    if (event.type === "command.accepted" || event.type === "command.rejected") {
      if (event.commandId) pendingCommands.delete(event.commandId);
      if (event.type === "command.rejected") {
        store.dispatch({ type: "command.rejected", commandId: event.commandId, reason: event.reason });
      } else {
        store.dispatch({ type: "command.accepted", commandId: event.commandId, queued: event.queued });
      }
      return;
    }
    // Adopt the authoritative thread id (e.g. a freshly created thread) so a
    // later reconnect resumes the same thread instead of creating a new one.
    if ((event.type === "ready" || event.type === "history.snapshot") && event.threadId && event.threadId !== threadId) {
      threadId = event.threadId;
      if (onThreadChange) onThreadChange(threadId);
    }
    if (event.type !== "message.delta") {
      if (deltaBuffer.size) {
        if (flushHandle != null) cancelAnimationFrame(flushHandle);
        flushDeltas();
      }
    }
    const seq = typeof event.seq === "number" ? event.seq : null;
    if (seq != null) {
      if (event.type === "history.snapshot") {
        if (seq < lastSeq) return; // ignore a stale snapshot
        lastSeq = seq;
        store.dispatch(event);
        return;
      }
      if (seq <= lastSeq) return; // duplicate or replayed event
      if (seq > lastSeq + 1) {
        send({ type: "resync" });
      }
      lastSeq = seq;
    }
    if (event.type === "message.delta") {
      deltaBuffer.set(event.messageId, (deltaBuffer.get(event.messageId) || "") + (event.delta || ""));
      scheduleFlush();
      return;
    }
    store.dispatch(event);
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastPong = Date.now();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(wire({ type: "ping" }));
      } catch {
        return;
      }
      if (Date.now() - lastPong > 50000) forceReconnect();
    }, 20000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function clearReconnect() {
    attempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (manualClose || reconnectTimer) return;
    const attempt = attempts;
    attempts = Math.min(attempts + 1, 6);
    const delay = Math.min(15000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
    store.dispatch({ type: "connection", status: "reconnecting", delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (document.hidden) return;
      connect(threadId);
    }, delay);
  }

  function forceReconnect() {
    if (manualClose) return;
    stopHeartbeat();
    const stale = ws;
    ws = null;
    if (stale) {
      try {
        stale.close();
      } catch {
        /* ignore */
      }
    }
    clearReconnect();
    if (!document.hidden) connect(threadId);
  }

  function connect(nextThreadId = threadId) {
    threadId = nextThreadId || "";
    manualClose = false;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    ws = null;
    lastSeq = 0;
    deltaBuffer = new Map();
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams();
    if (!isCookieReady() && getToken()) query.set("token", getToken());
    if (threadId) query.set("thread", threadId);
    const url = `${proto}//${location.host}/bridge${query.toString() ? `?${query}` : ""}`;
    const socket = new WebSocket(url);
    ws = socket;
    store.dispatch({ type: "connection", status: "connecting" });

    socket.addEventListener("open", (event) => {
      if (event.currentTarget !== ws) return;
      clearReconnect();
      startHeartbeat();
      store.dispatch({ type: "connection", status: "open" });
      // Re-send everything not yet acknowledged (server dedupes by commandId),
      // plus any non-command frames queued while offline.
      const queued = outbox.splice(0);
      const frames = [...pendingCommands.values(), ...queued];
      for (const payload of frames) {
        try {
          socket.send(wire(payload));
        } catch {
          /* ignore */
        }
      }
    });
    socket.addEventListener("message", (event) => {
      if (event.currentTarget !== ws) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleEvent(message);
    });
    socket.addEventListener("close", (event) => {
      if (event.currentTarget !== ws) return;
      stopHeartbeat();
      store.dispatch({ type: "connection", status: "closed" });
      // Sent-but-unacknowledged commands become "pending confirmation" while we
      // cannot reach the server; they are re-sent with the same id on reconnect.
      for (const cmd of pendingCommands.values()) {
        store.dispatch({ type: "command.unknown", commandId: cmd.commandId, reason: "连接中断，等待确认" });
      }
      if (!manualClose) scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      /* close handler drives reconnect */
    });
  }

  function forgetCommand(commandId) {
    // "恢复输入" hands the failed text back to the user; the automatic resend
    // of the original command must stop NOW, otherwise restoring and then
    // re-sending produces two executions with two different ids that the
    // server cannot correlate.
    if (commandId) pendingCommands.delete(commandId);
  }

  function setThread(nextThreadId) {
    if (nextThreadId === threadId && ws && ws.readyState === WebSocket.OPEN) return;
    clearReconnect();
    outbox.length = 0; // never deliver queued frames to a different thread
    pendingCommands.clear();
    try {
      ws && ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
    // Switching conversations must visibly leave the old one immediately.
    store.dispatch({ type: "messages.clear" });
    store.dispatch({ type: "command.clear" });
    if (onThreadChange) onThreadChange(nextThreadId);
    connect(nextThreadId);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      clearReconnect();
      connect(threadId);
    } else {
      send({ type: "resync" });
    }
  });

  window.addEventListener("online", () => {
    if (document.hidden) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      clearReconnect();
      connect(threadId);
    }
  });

  return {
    connect,
    setThread,
    send,
    forgetCommand,
    // Force a fresh socket even if the current one is still OPEN (used when the
    // bridge is reachable but the upstream/thread is stuck).
    reconnect() {
      clearReconnect();
      const stale = ws;
      ws = null;
      if (stale) {
        try {
          stale.close();
        } catch {
          /* ignore */
        }
      }
      connect(threadId);
    },
    close() {
      manualClose = true;
      clearReconnect();
      stopHeartbeat();
      try {
        ws && ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    },
    get threadId() {
      return threadId;
    },
    isOpen() {
      return Boolean(ws && ws.readyState === WebSocket.OPEN);
    },
  };
}
