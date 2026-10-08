// Real-server contract tests: the phone bridge's actual HTTP responses are the
// single source of truth the UI consumes, so these fixtures assert the wire
// format directly (minting C-01/C-02-style field mismatches impossible to miss
// again). No browser, no real provider, no account usage.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const TOKEN = "contract-token-123";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

function initGitRepo(dir) {
  const git = (args) => {
    const r = require("child_process").spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git(["init"]);
  git(["config", "user.email", "contract@example.com"]);
  git(["config", "user.name", "Contract"]);
  return git;
}

async function startBridge(workdir) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, "start-phone.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PHONE_AGENT_PROVIDER: "claude",
      PHONE_TOKEN: TOKEN,
      PHONE_UI_PORT: String(port),
      PHONE_WORKDIR: workdir,
      CODEX_WORKDIR: workdir,
      // The session secret must live OUTSIDE the workdir: it is an untracked
      // file, and polluting the audited tree would flip review.contracts.
      PHONE_SESSION_FILE: path.join(os.tmpdir(), `contract-session-${port}`),
      PHONE_BIND_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
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
  return { child, port, stop: () => new Promise((r) => (child.once("exit", r), child.kill("SIGKILL"))) };
}

test("/api/file wire contract: image fields with canonical url + size", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-file-"));
  fs.writeFileSync(path.join(dir, "pixel.png"), PNG_1PX);
  const bridge = await startBridge(dir);
  t.after(() => bridge.stop());

  // An unauthenticated read must never leak file contents.
  assert.equal((await request(bridge.port, { path: `/api/file?path=pixel.png` })).status, 401);

  const authed = await request(bridge.port, {
    path: `/api/file?path=${encodeURIComponent("pixel.png")}&token=${TOKEN}`,
  });
  assert.equal(authed.status, 200);
  const body = JSON.parse(authed.body);
  assert.equal(body.kind, "image");
  assert.ok(typeof body.url === "string" && body.url.startsWith("/api/file/raw?path="), "canonical url present");
  assert.equal(body.imageUrl, body.url, "legacy alias matches canonical url (C-01 contract)");
  assert.equal(body.size, PNG_1PX.length);
  assert.equal(body.truncated, false);
});

test("/api/file wire contract: text truncation metadata", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-file-"));
  fs.writeFileSync(path.join(dir, "small.txt"), "hello");
  fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(80_001));
  const bridge = await startBridge(dir);
  t.after(() => bridge.stop());

  const small = JSON.parse(
    (await request(bridge.port, { path: `/api/file?path=small.txt&token=${TOKEN}` })).body,
  );
  assert.equal(small.kind, "text");
  assert.equal(small.truncated, false);
  assert.equal(small.size, 5);

  const big = JSON.parse(
    (await request(bridge.port, { path: `/api/file?path=big.txt&token=${TOKEN}` })).body,
  );
  assert.equal(big.truncated, true);
  assert.equal(big.text.length, 80_000);
  assert.equal(big.size, 80_001);
});

test("/api/review wire contract: working tree vs latest commit semantics", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-review-"));
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  const git = initGitRepo(dir);
  git(["add", "a.txt"]);
  git(["commit", "-m", "init"]);
  const bridge = await startBridge(dir);
  t.after(() => bridge.stop());
  const authPath = `/api/review?token=${TOKEN}`;

  // 1) Clean tree + populated HEAD: clean must describe the WORKING TREE.
  const clean = JSON.parse((await request(bridge.port, { path: authPath })).body);
  assert.equal(clean.workingTreeClean, true, "no uncommitted edits -> working tree clean");
  assert.equal(clean.clean, true, "legacy field agrees with workingTreeClean");
  assert.equal(clean.source, "latest commit", "populated HEAD falls back to latest-commit view");
  assert.ok(
    Array.isArray(clean.files) && clean.files.length >= 1,
    `latest-commit fallback still lists files: ${JSON.stringify(clean)}`,
  );

  // 2) Uncommitted edit: source flips to working tree with the file listed.
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  const dirty = JSON.parse((await request(bridge.port, { path: authPath })).body);
  assert.equal(dirty.workingTreeClean, false);
  assert.equal(dirty.clean, false);
  assert.equal(dirty.source, "working tree");
  assert.ok(dirty.files.some((f) => f.path === "a.txt"));

  // 3) Stage + commit: back to clean with latest-commit fallback.
  git(["add", "a.txt"]);
  git(["commit", "-m", "second"]);
  const committed = JSON.parse((await request(bridge.port, { path: authPath })).body);
  assert.equal(committed.workingTreeClean, true);
  assert.equal(committed.source, "latest commit");
});

test("unauthenticated or wrongly authed file reads are rejected", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-file-"));
  fs.writeFileSync(path.join(dir, "secret.txt"), "s");
  const bridge = await startBridge(dir);
  t.after(() => bridge.stop());
  assert.equal((await request(bridge.port, { path: `/api/file?path=secret.txt` })).status, 401);
  assert.equal(
    (await request(bridge.port, { path: `/api/file?path=secret.txt&token=WRONG` })).status,
    401,
  );
});
