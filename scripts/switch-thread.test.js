// Thread-switching contract: a REAL bridge against a FAKE Codex app-server.
//
// Scenario A (device-reported): thread/resume rejected ("already has an
// active writer") because a LOCAL desktop Codex client holds the per-thread
// writer lock (file flock under ~/.codex/thread-writer-locks; this protocol
// version has no unload API) — the bridge stayed unready forever and the
// phone kept showing the previous conversation.
//
// Scenario B (swallowed send): a prompt sent BEFORE the thread is ready must
// be executed exactly once once the thread resumes — the earlier flush bug
// pre-registered the commandId, so prompt() dropped the queued message as a
// "duplicate" and the same id could never be re-delivered.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { WebSocketServer, WebSocket } = require("ws");

const TOKEN = "switch-token-123";

async function startFakeAppServer({ permanentWriterLock = false } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
  const script = { resumeAttempts: 0, turnStarts: 0 };
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg.id) return; // notifications
      if (msg.method === "initialize") {
        ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
        return;
      }
      if (msg.method === "thread/loaded/list") {
        ws.send(JSON.stringify({ id: msg.id, result: { data: [], nextCursor: null } }));
        return;
      }
      if (msg.method === "thread/resume") {
        script.resumeAttempts += 1;
        if (permanentWriterLock) {
          // Simulate the desktop daemon permanently holding the writer lock.
          ws.send(JSON.stringify({ id: msg.id, error: { code: -32600, message: `thread ${msg.params.threadId} already has an active writer` } }));
          return;
        }
        ws.send(JSON.stringify({ id: msg.id, result: { thread: { id: msg.params.threadId, turns: [] } } }));
        return;
      }
      if (msg.method === "turn/start") {
        script.turnStarts += 1;
        ws.send(JSON.stringify({ id: msg.id, result: { turn: { id: `turn-${script.turnStarts}` } } }));
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
    });
  });
  return { port, script, wss };
}

function startBridge(fake, port) {
  return spawn(process.execPath, [path.join(__dirname, "start-phone.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      CODEX_APP_SERVER_URL: `ws://127.0.0.1:${fake.port}`,
      PHONE_TOKEN: TOKEN,
      PHONE_UI_PORT: String(port),
      PHONE_WORKDIR: path.join(os.tmpdir(), `switch-wd-${port}`),
      CODEX_WORKDIR: path.join(os.tmpdir(), `switch-wd-${port}`),
      PHONE_SESSION_FILE: path.join(os.tmpdir(), `switch-session-${port}`),
      PHONE_BIND_HOST: "127.0.0.1",
      PHONE_DETACH_GRACE_MS: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitBridgeReady(child) {
  const bridgeLog = [];
  child.stdout.on("data", (c) => bridgeLog.push(c.toString()));
  child.stderr.on("data", (c) => bridgeLog.push(c.toString()));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${bridgeLog.join("").slice(-600)}`)), 15000);
    child.stdout.on("data", (c) => {
      if (c.toString().includes("is ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return bridgeLog;
}

// Deterministic teardown: the bridge owns client sockets on the fake server,
// so the fake can only close AFTER the bridge is gone (a naive pair of
// t.after hooks deadlocks on that ordering).
async function teardown(child, fake) {
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  await new Promise((resolve) => fake.wss.close(resolve));
}

test("locked thread: single resume attempt + actionable error, no spin", async (t) => {
  const fake = await startFakeAppServer({ permanentWriterLock: true });
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = startBridge(fake, port);
  const bridgeLog = await waitBridgeReady(child);

  const threadId = `sw-${crypto.randomUUID()}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge?thread=${threadId}&token=${TOKEN}`, { perMessageDeflate: false });
  const events = [];
  await new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (events.some((event) => event.type === "error" && /其他 Codex 客户端占用/.test(event.text || ""))) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        events.push(event);
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (error) => {
      clearInterval(poll);
      reject(error);
    });
    setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`no actionable writer-lock error; events=${JSON.stringify(events.map((e) => e.type))}; log=${bridgeLog.join("").slice(-800)}`));
    }, 12000);
  }).finally(() => ws.close());

  // Exactly one resume attempt against the occupied thread — no retries.
  assert.equal(fake.script.resumeAttempts, 1, "resume attempted exactly once for a locked thread");
  // Honesty over fake success: no ready/snapshot for a thread we cannot own.
  assert.ok(
    !events.some((e) => e.type === "ready" && e.threadId === threadId),
    "no ready for a locked thread",
  );

  await teardown(child, fake);
});

test("pre-ready prompt runs exactly once when the thread becomes ready", async (t) => {
  const fake = await startFakeAppServer({ permanentWriterLock: false });
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = startBridge(fake, port);
  const bridgeLog = await waitBridgeReady(child);

  const threadId = `sw-${crypto.randomUUID()}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge?thread=${threadId}&token=${TOKEN}`, { perMessageDeflate: false });
  const events = [];
  await new Promise((resolve, reject) => {
    // The prompt is sent IMMEDIATELY on socket open — the thread is still
    // resuming, so the command must queue pre-ready and then execute.
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "prompt", text: "queued before ready", commandId: "pre-ready-1", token: TOKEN }));
    });
    const poll = setInterval(() => {
      if (events.some((event) => event.type === "message.started" && event.role === "user" && event.commandId === "pre-ready-1")) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        events.push(event);
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (error) => {
      clearInterval(poll);
      reject(error);
    });
    setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`pre-ready prompt never executed; events=${JSON.stringify(events.map((e) => ({ t: e.type, c: e.commandId })))}; log=${bridgeLog.join("").slice(-800)}`));
    }, 12000);
  }).finally(() => ws.close());

  // The queued prompt reached the upstream exactly once.
  assert.equal(fake.script.turnStarts, 1, "turn/start hit exactly once");
  // The client got the honest lifecycle: queued ack -> dispatched (upstream
  // accepted the turn) -> user echo carrying the commandId.
  assert.ok(
    events.some((e) => e.type === "command.accepted" && e.commandId === "pre-ready-1" && e.queued),
    "command accepted while queued",
  );
  assert.ok(
    events.some((e) => e.type === "command.dispatched" && e.commandId === "pre-ready-1"),
    "command dispatched once the turn starts",
  );
  // A reconnect re-sending the SAME id must NOT re-execute the turn.
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/bridge?thread=${threadId}&token=${TOKEN}`, { perMessageDeflate: false });
  await new Promise((resolve) => {
    ws2.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === "ready" && event.threadId === threadId) resolve();
      } catch {
        /* ignore */
      }
    });
    ws2.on("open", () => ws2.send(JSON.stringify({ type: "prompt", text: "queued before ready", commandId: "pre-ready-1", token: TOKEN })));
    setTimeout(resolve, 4000);
  }).finally(() => ws2.close());
  assert.equal(fake.script.turnStarts, 1, "re-sent id is deduped, turn NOT re-executed");

  await teardown(child, fake);
});
