const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const TOKEN = "integration-token-123";

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: options.path || "/", method: options.method || "GET", headers: options.headers || {} },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function startBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-it-"));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, "start-phone.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PHONE_AGENT_PROVIDER: "claude",
      PHONE_TOKEN: TOKEN,
      PHONE_UI_PORT: String(port),
      PHONE_WORKDIR: dir,
      CODEX_WORKDIR: dir,
      CODEX_HOME: path.join(dir, "codex-home"),
      PHONE_BIND_HOST: "127.0.0.1",
      PHONE_SESSION_FILE: path.join(dir, ".phone-session"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bridge did not start in time")), 15000);
    const onData = (buf) => {
      if (buf.toString().includes("is ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`bridge exited early (code=${code})`));
    });
  });
  await ready;
  return { child, port, dir, stop: () => new Promise((r) => (child.once("exit", r), child.kill("SIGKILL"))) };
}

test("POST /api/auth issues an HttpOnly session cookie for the right token", async (t) => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  const noHeader = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  // CSRF guard: cross-site forms cannot attach a custom header.
  assert.equal(noHeader.status, 403);

  const bad = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-client": "1" },
    body: JSON.stringify({ token: "wrong" }),
  });
  assert.equal(bad.status, 401);

  const ok = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-client": "1" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers["set-cookie"];
  assert.ok(setCookie, "expected a Set-Cookie header");
  const cookie = setCookie[0];
  assert.match(cookie, /codex_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  // The integration bridge serves plain HTTP (as the phone does over
  // Tailscale LAN): WebView rejects Secure cookies on insecure origins, so
  // the attribute must NOT be present here.
  assert.doesNotMatch(cookie, /Secure/);

  // Simulating a proxy terminates TLS: keep Secure then.
  const httpsLike = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-client": "1", "x-forwarded-proto": "https" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.match(httpsLike.headers["set-cookie"][0], /Secure/);
});

test("authed endpoints accept the session cookie and reject tokenless requests", async (t) => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  const anon = await request(bridge.port, { path: "/api/threads" });
  assert.equal(anon.status, 401);

  const auth = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-client": "1" },
    body: JSON.stringify({ token: TOKEN }),
  });
  const cookie = auth.headers["set-cookie"][0].split(";")[0];

  const viaCookie = await request(bridge.port, { path: "/api/threads", headers: { cookie } });
  assert.equal(viaCookie.status, 200);

  const viaToken = await request(bridge.port, { path: `/api/threads?token=${TOKEN}` });
  assert.equal(viaToken.status, 200);
});

test("DELETE /api/auth clears the session cookie", async (t) => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  const auth = await request(bridge.port, {
    path: "/api/auth",
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-client": "1" },
    body: JSON.stringify({ token: TOKEN }),
  });
  const cookie = auth.headers["set-cookie"][0].split(";")[0];

  const cleared = await request(bridge.port, { path: "/api/auth", method: "DELETE", headers: { cookie, "x-codex-client": "1" } });
  assert.equal(cleared.status, 200);
  assert.match(cleared.headers["set-cookie"][0], /codex_session=;/);
  assert.match(cleared.headers["set-cookie"][0], /Max-Age=0/);
});
