// WebSocket connection manager: reconnect w/ backoff, heartbeat, gap resync,
// and rAF-coalesced streaming deltas.

import { token } from "./api.js";

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

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ token, ...payload }));
    } else {
      // Queue while disconnected; flushed on the next open so a prompt or
      // approval tapped during a brief drop is not lost.
      outbox.push(payload);
    }
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
    if (event.type !== "message.delta") {
      if (deltaBuffer.size) {
        if (flushHandle != null) cancelAnimationFrame(flushHandle);
        flushDeltas();
      }
    }
    const seq = typeof event.seq === "number" ? event.seq : null;
    if (seq != null) {
      if (event.type === "history.snapshot") {
        lastSeq = seq;
        store.dispatch(event);
        return;
      }
      if (seq > lastSeq + 1) {
        send({ type: "resync" });
      }
      lastSeq = Math.max(lastSeq, seq);
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
        ws.send(JSON.stringify({ type: "ping", token }));
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
    if (token) query.set("token", token);
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
      if (outbox.length) {
        const queued = outbox.splice(0);
        for (const payload of queued) {
          try {
            socket.send(JSON.stringify({ token, ...payload }));
          } catch {
            /* ignore */
          }
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
      if (!manualClose) scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      /* close handler drives reconnect */
    });
  }

  function setThread(nextThreadId) {
    if (nextThreadId === threadId && ws && ws.readyState === WebSocket.OPEN) return;
    clearReconnect();
    outbox.length = 0; // never deliver queued frames to a different thread
    try {
      ws && ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
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
