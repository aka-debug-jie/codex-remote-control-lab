// Thread-switching contract: a REAL bridge against a FAKE Codex app-server.
// Reproduces the exact device-reported failure chain:
//   thread/resume rejected ("already has an active writer") -> bridge stayed
//   unready forever -> the phone kept showing the previous conversation.
// The fix contract: unload the dangling writer, retry once, then deliver
// ready + history.snapshot for the resumed thread.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { WebSocketServer, WebSocket } = require("ws");

const TOKEN = "switch-token-123";

async function startFakeAppServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
    const script = {
    sawUnload: false,
    resumeAttempts: 0,
  };
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
        if (script.resumeAttempts === 1) {
          ws.send(JSON.stringify({ id: msg.id, error: { code: -32600, message: `thread ${msg.params.threadId} already has an active writer` } }));
          return;
        }
        ws.send(JSON.stringify({ id: msg.id, result: { thread: { id: msg.params.threadId, turns: [] } } }));
        return;
      }
      if (msg.method === "thread/unload") {
        script.sawUnload = true;
        ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
    });
  });
  
  return { port, script, wss };
}

function wsRequest(port, urlPath) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`, { perMessageDeflate: false });
    const events = [];
    ws.on("message", (data) => {
      try {
        events.push(JSON.parse(data.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on("error", reject);
    const timer = setTimeout(() => reject(new Error(`timeout: got ${JSON.stringify(events.map((e) => e.type))}`)), 12000);
    const wait = (predicate) => {
      if (predicate(events)) {
        clearTimeout(timer);
        resolve({ events, close: () => ws.close() });
        return true;
      }
      return false;
    };
    ws._wait = wait;
    ws._interval = setInterval(() => ws._poll && ws._poll(), 100);
    ws._originalWait = wait;
  });
}

test("thread switch survives a dangling writer lock: unload -> resume retry -> snapshot", async (t) => {
  const fake = await startFakeAppServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-switch-"));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, "start-phone.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      CODEX_APP_SERVER_URL: `ws://127.0.0.1:${fake.port}`,
      PHONE_TOKEN: TOKEN,
      PHONE_UI_PORT: String(port),
      PHONE_WORKDIR: dir,
      CODEX_WORKDIR: dir,
      PHONE_SESSION_FILE: path.join(os.tmpdir(), `switch-session-${port}`),
      PHONE_BIND_HOST: "127.0.0.1",
      // Shorten detach grace so a switch cannot be blocked by the policy either.
      PHONE_DETACH_GRACE_MS: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bridgeLog = [];
  child.stdout.on("data", (c) => bridgeLog.push(c.toString()));
  child.stderr.on("data", (c) => bridgeLog.push(c.toString()));
  
  
  // The HTTP listener must be up before the WS client dials (ECONNREFUSED otherwise).
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${bridgeLog.join("").slice(-600)}`)), 15000);
    child.stdout.on("data", (c) => {
      if (c.toString().includes("is ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

    const threadId = `sw-${crypto.randomUUID()}`;
  // The client asks for a specific thread; the first resume is rejected with
  // the writer lock error, the bridge must unload + retry and then deliver.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge?thread=${threadId}&token=${TOKEN}`, { perMessageDeflate: false });
  const events = [];
  await new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (events.some((event) => event.type === "history.snapshot" && event.threadId === threadId)) {
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
      reject(new Error(`no snapshot for switched thread; events=${JSON.stringify(events.map((e) => e.type))}; log=${bridgeLog.join("").slice(-800)}`));
    }, 12000);
  }).finally(() => ws.close());
  
    assert.ok(
    events.some((e) => e.type === "ready" && e.threadId === threadId),
    "ready carries the resumed thread id",
  );
  assert.ok(fake.script.sawUnload, "dangling writer was unloaded before the retry");
  assert.equal(fake.script.resumeAttempts, 2, "resume attempted exactly twice (initial + retry)");
    // Deterministic teardown: the bridge owns client sockets on the fake server,
  // so the fake can only close AFTER the bridge is gone (a naive pair of
  // t.after hooks deadlocks on that ordering).
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  await new Promise((resolve) => fake.wss.close(resolve));
});
