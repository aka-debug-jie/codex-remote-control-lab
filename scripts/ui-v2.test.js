"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const token = "ui-v2-token";

const mime = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "application/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
]);

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = path.resolve(publicDir, `.${pathname}`);
    if (!target.startsWith(`${publicDir}${path.sep}`) && target !== path.join(publicDir, "index.html")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": mime.get(path.extname(target)) || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on("error", reject);
  });
}

async function mockApi(page, state = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const respond = (json) => route.fulfill({ json });
    if (url.pathname === "/api/auth") return route.fulfill({ status: 200, json: { ok: true, tokenRequired: true } });
    if (url.pathname === "/api/info") return respond({ tokenRequired: true, authMode: "token" });
    if (url.pathname === "/api/artifacts") return respond({ data: state.artifacts || [], artifacts: state.artifacts || [] });
    if (url.pathname === "/api/threads") return respond({ data: state.threads || [], threads: state.threads || [] });
    if (url.pathname === "/api/thread") return respond(state.threadSnapshots?.[url.searchParams.get("thread")] || { threadId: url.searchParams.get("thread"), history: [] });
    if (url.pathname === "/api/review") return respond(state.review || { clean: true, files: [], source: "working tree" });
    if (url.pathname === "/api/skills") return respond({ data: state.skills || [] });
    if (url.pathname === "/api/models") return respond({ data: state.models || [] });
    if (url.pathname === "/api/plugins") return respond(state.plugins || { marketplaces: [] });
    if (url.pathname === "/api/automations") return respond({ data: state.automations || [] });
    if (url.pathname === "/api/status") return respond({ provider: "codex", uiPort: 45214, workdir: root, workspaceLocation: root, gitBranch: "main" });
    if (url.pathname === "/api/config") return respond({ config: { config: { provider: "codex" } } });
    if (url.pathname === "/api/workspace") return respond({ data: state.workspace || [] });
    if (url.pathname === "/api/file") return respond(state.files?.[url.searchParams.get("path")] || { path: url.searchParams.get("path"), kind: "text", text: "" });
    return respond({});
  });
}

async function mockWebSocket(page, options = {}) {
  await page.addInitScript(
    (config) => {
      window.__sentFrames = [];
      window.__mockSockets = [];
      if (config.seedCache) {
        try {
          for (const [key, value] of Object.entries(config.seedCache)) localStorage.setItem(key, value);
        } catch {
          /* ignore */
        }
      }
      window.__dispatchServerMessage = (payload) => {
        for (const socket of window.__mockSockets) socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
      };
      window.__closeMockSockets = () => {
        for (const socket of window.__mockSockets) socket.close();
      };
      class MockWebSocket extends EventTarget {
        constructor(url) {
          super();
          this.readyState = MockWebSocket.CONNECTING;
          this.url = url;
          window.__mockSockets.push(this);
          const socketUrl = new URL(url, location.href);
          const threadId = socketUrl.searchParams.get("thread") || "";
          const ready = config.readyPayloadByThread[threadId] || config.defaultReadyPayload;
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.dispatchEvent(new Event("open"));
            if (ready) {
              this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(ready) }));
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({ type: "history.snapshot", threadId: ready.threadId, seq: 0, messages: ready.history || [] }),
                }),
              );
            }
          }, config.readyDelay ?? 10);
        }
        send(frame) {
          window.__sentFrames.push(JSON.parse(frame));
        }
        close() {
          this.readyState = MockWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close"));
        }
      }
      MockWebSocket.CONNECTING = 0;
      MockWebSocket.OPEN = 1;
      MockWebSocket.CLOSING = 2;
      MockWebSocket.CLOSED = 3;
      window.WebSocket = MockWebSocket;
    },
    {
      defaultReadyPayload: options.defaultReadyPayload || {
        type: "ready",
        threadId: "thread-v2",
        history: [],
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
      },
      readyDelay: options.readyDelay ?? 10,
      readyPayloadByThread: options.readyPayloadByThread || {},
      seedCache: options.seedCache || null,
    },
  );
}

async function boot(t, options = {}) {
  const server = await startStaticServer();
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await server.close();
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await mockApi(page, options.apiState || {});
  await mockWebSocket(page, options.ws || {});
  const threadParam = options.thread ? `&thread=${options.thread}` : "";
  await page.goto(`${server.origin}/?token=${token}${threadParam}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#send");
  return { page, errors, origin: server.origin };
}

// Long-press a message to open the MD3 action sheet.
async function longPress(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForSelector(".bottom-sheet.open", { timeout: 3000 });
}

test("renders the React shell with composer, sidebar and run state", async (t) => {
  const { page, errors } = await boot(t, { apiState: { threads: [{ id: "t1", name: "Thread 1", updatedAt: Date.now() }] } });
  assert.equal(await page.locator("#composer").count(), 1);
  assert.equal(await page.locator("#modelButton").count(), 1);
  assert.ok((await page.locator(".thread-item").count()) >= 1);
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "ready");
  assert.deepEqual(errors, []);
});

test("history snapshot renders messages from the server", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        history: [
          { type: "user", text: "你好" },
          { type: "assistant", text: "**你好**世界" },
        ],
      },
    },
  });
  await page.getByText("你好", { exact: false }).first().waitFor();
  assert.equal(await page.locator(".entry.assistant .entry-body").count(), 1);
  assert.match(await page.locator(".entry.assistant .entry-body").first().innerHTML(), /<strong>/);
});

test("live streaming splits separate agent messages into distinct bubbles", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    const send = window.__dispatchServerMessage;
    send({ type: "message.started", messageId: "m1", role: "assistant", seq: 1 });
    send({ type: "message.delta", messageId: "m1", delta: "第一段", seq: 2 });
    send({ type: "message.delta", messageId: "m1", delta: "内容", seq: 3 });
    send({ type: "message.finished", messageId: "m1", role: "assistant", text: "第一段内容", seq: 4 });
    send({ type: "message.started", messageId: "m2", role: "assistant", seq: 5 });
    send({ type: "message.delta", messageId: "m2", delta: "第二段内容", seq: 6 });
    send({ type: "message.finished", messageId: "m2", role: "assistant", text: "第二段内容", seq: 7 });
  });
  await page.waitForTimeout(300);
  const bodies = await page.locator(".entry.assistant .entry-body").allInnerTexts();
  assert.equal(bodies.length, 2, JSON.stringify(bodies));
  assert.match(bodies[0], /第一段内容/);
  assert.match(bodies[1], /第二段内容/);
});

test("tool events render structured tool cards with command and output", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    window.__dispatchServerMessage({ type: "tool.started", toolCallId: "x1", kind: "command", name: "echo hi", input: { command: "echo hi" }, seq: 1 });
    window.__dispatchServerMessage({ type: "tool.finished", toolCallId: "x1", kind: "command", status: "completed", output: "hi\n", exitCode: 0, durationMs: 7, seq: 2 });
  });
  await page.waitForSelector(".entry.tool .tool-card");
  assert.match(await page.locator(".entry.tool .tool-name").first().textContent(), /echo hi/);
  await page.locator(".tool-output summary").first().click();
  await page.waitForTimeout(100);
  assert.match(await page.locator(".tool-output pre").first().textContent(), /hi/);
});

test("model sheet opens and selecting reasoning updates the label", async (t) => {
  const { page } = await boot(t);
  await page.click("#modelButton");
  await page.waitForSelector(".bottom-sheet.open");
  await page.locator('.segmented button:has-text("高")').first().click();
  await page.waitForTimeout(150);
  assert.match(await page.locator("#modelButton").innerText(), /高/);
});

test("panels sheet tabs switch titles and theme selection keeps the sheet open", async (t) => {
  const { page } = await boot(t, { apiState: { review: { notGitRepo: true }, workspace: [{ path: "a.md", name: "a.md", kind: "markdown" }] } });
  await page.click("#menuButton");
  await page.waitForSelector(".bottom-sheet.open");
  for (const [label, selector] of [["工作区", "#workspaceTab"], ["审查", "#reviewTab"], ["后台", "#statusButton"], ["信息来源", "#webSearchButton"], ["产物", "#artifactTab"]]) {
    await page.click(selector);
    await page.waitForTimeout(400);
    assert.match(await page.locator("#artifactTitle").innerText(), new RegExp(label));
  }
  await page.locator(".bottom-sheet.open .sheet-close").click();
  await page.waitForTimeout(300);
  await page.click("#mobileThreads");
  await page.waitForSelector(".drawer.open");
  await page.click("#settingsButton");
  await page.waitForSelector(".bottom-sheet.open");
  const options = page.locator(".theme-option");
  assert.ok((await options.count()) >= 3);
  await options.nth(2).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator(".bottom-sheet.open").isVisible());
});

test("access button cycles sandbox modes", async (t) => {
  const { page } = await boot(t);
  const first = (await page.locator("#accessButton").innerText()).trim();
  await page.click("#accessButton");
  await page.waitForTimeout(100);
  const second = (await page.locator("#accessButton").innerText()).trim();
  assert.notEqual(first, second);
});

test("prompt modal applies text back to the composer", async (t) => {
  const { page } = await boot(t);
  await page.click("#expandPromptButton");
  await page.waitForTimeout(200);
  await page.fill("#promptModalInput", "放大后的内容");
  await page.click("#applyPromptModalButton");
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue("#prompt"), "放大后的内容");
});

test("slash menu lists skills and inserts a command", async (t) => {
  const { page } = await boot(t, {
    apiState: { skills: [{ id: "s1", name: "demo", trigger: "/demo", description: "demo skill" }] },
  });
  await page.click("#prompt");
  await page.type("#prompt", "/");
  await page.waitForSelector("#slashSkillMenu .slash-skill-row");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue("#prompt"), "/demo ");
});

test("a dropped socket flips run state to reconnecting", async (t) => {
  const { page } = await boot(t);
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "ready");
  await page.evaluate(() => window.__closeMockSockets());
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "reconnecting", null, { timeout: 5000 });
});

test("code blocks are syntax-highlighted after streaming settles", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    const send = window.__dispatchServerMessage;
    const text = "```js\nconst x = 1;\n```";
    send({ type: "message.started", messageId: "c1", role: "assistant", seq: 1 });
    send({ type: "message.delta", messageId: "c1", delta: text, seq: 2 });
    send({ type: "message.finished", messageId: "c1", role: "assistant", text, seq: 3 });
  });
  await page.waitForSelector(".entry.assistant pre code .hl-keyword", { timeout: 5000 });
  const html = await page.locator(".entry.assistant pre code").first().innerHTML();
  assert.match(html, /hl-keyword/);
  assert.match(html, /hl-number/);
});

test("streaming delta does not re-render the app shell", async (t) => {
  const { page } = await boot(t);
  // Mark the sidebar node, then stream a delta; if App re-rendered, React would
  // reconcile but memoized Sidebar keeps the same DOM node. Verify identity too.
  await page.evaluate(() => {
    window.__sidebarNode = document.querySelector("#threadSidebar");
    window.__dispatchServerMessage({ type: "message.started", messageId: "m1", role: "assistant", seq: 1 });
    window.__dispatchServerMessage({ type: "message.delta", messageId: "m1", delta: "x", seq: 2 });
  });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => window.__sidebarNode === document.querySelector("#threadSidebar")));
});

test("large streamed message keeps code fences and paragraphs intact", async (t) => {
  const { page } = await boot(t);
  const result = await page.evaluate(async () => {
    const send = window.__dispatchServerMessage;
    const chunks = ["第一段。\n\n", "```js\n", "const a = 1;\n", "\n", "const b = 2;\n", "```\n\n", "第二段。"];
    let seq = 1;
    send({ type: "message.started", messageId: "big", role: "assistant", seq });
    for (const chunk of chunks) {
      seq += 1;
      for (let i = 0; i < 40; i += 1) send({ type: "message.delta", messageId: "big", delta: chunk, seq });
    }
    seq += 1;
    send({ type: "message.finished", messageId: "big", role: "assistant", text: chunks.join(""), seq });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const body = document.querySelector(".entry.assistant .entry-body");
    return { pre: body?.querySelector("pre")?.textContent || "", text: body?.innerText || "" };
  });
  assert.match(result.pre, /const a = 1;/);
  assert.match(result.pre, /const b = 2;/);
  assert.match(result.text, /第一段/);
  assert.match(result.text, /第二段/);
});

test("usage.updated renders the token badge", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    window.__dispatchServerMessage({
      type: "usage.updated",
      seq: 1,
      total: { totalTokens: 12345, inputTokens: 12000, outputTokens: 345 },
      last: { totalTokens: 100 },
    });
  });
  await page.waitForSelector(".usage-badge");
  assert.match(await page.locator(".usage-badge").innerText(), /12\.0k/);
});

test("run.finished shows the turn duration", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    window.__dispatchServerMessage({ type: "run.started", turnId: "t", seq: 1 });
    window.__dispatchServerMessage({ type: "run.finished", turnId: "t", status: "completed", durationMs: 4321, seq: 2 });
  });
  await page.waitForFunction(() => /s$/.test(document.querySelector("#runStateLabel")?.textContent || ""));
  assert.match(await page.locator("#runStateLabel").innerText(), /4\.3s/);
});

test("approval always-allow sends decision accept with always flag", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    window.__dispatchServerMessage({ type: "approval.requested", approvalId: 7, request: { id: 7, method: "item/commandExecution/requestApproval", params: {} }, seq: 1 });
  });
  await page.waitForSelector(".approval button:has-text(\"始终允许\")");
  await page.locator('.approval button:has-text("始终允许")').click();
  await page.waitForTimeout(120);
  const frames = await page.evaluate(() => window.__sentFrames);
  const approval = frames.find((f) => f.type === "approval");
  assert.ok(approval, "approval frame sent");
  assert.equal(approval.decision, "accept");
  assert.equal(approval.always, true);
});

test("retry on a user message re-sends it; edit fills the composer", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [{ type: "user", text: "原始提问内容" }],
      },
    },
  });
  await page.getByText("原始提问内容").first().waitFor();
  await longPress(page, page.locator(".entry.user").first());
  await page.locator('.bottom-sheet .list-row:has-text("重试")').click();
  await page.waitForTimeout(120);
  const prompt = (await page.evaluate(() => window.__sentFrames)).find((f) => f.type === "prompt");
  assert.ok(prompt, "prompt frame sent");
  assert.match(prompt.text, /原始提问内容/);

  await longPress(page, page.locator(".entry.user").first());
  await page.locator('.bottom-sheet .list-row:has-text("编辑重发")').click();
  await page.waitForTimeout(120);
  assert.equal(await page.inputValue("#prompt"), "原始提问内容");
});

test("commands carry a commandId and stop resending after ACK", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [{ type: "user", text: "ACK 测试内容" }],
      },
    },
  });
  await page.getByText("ACK 测试内容").first().waitFor();
  await page.evaluate(() => window.__closeMockSockets());
  await longPress(page, page.locator(".entry.user").first());
  await page.locator('.bottom-sheet .list-row:has-text("重试")').click();
  await page.evaluate(() => document.querySelector("#connect")?.click());
  await page.waitForFunction(() => (window.__sentFrames || []).some((f) => f.type === "prompt" && f.commandId), null, { timeout: 8000 });
  const cmdId = await page.evaluate(() => (window.__sentFrames.find((f) => f.type === "prompt") || {}).commandId);
  assert.ok(cmdId, "prompt carries commandId");
  await page.evaluate((id) => window.__dispatchServerMessage({ type: "command.accepted", commandId: id }), cmdId);
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.__sentFrames.filter((f) => f.type === "prompt").length);
  await page.evaluate(() => window.__closeMockSockets());
  await page.evaluate(() => document.querySelector("#connect")?.click());
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__sentFrames.filter((f) => f.type === "prompt").length);
  assert.equal(after, before, "ACKed command must not be resent");
});

test("remembers the last thread and reconnects to it after relaunch", async (t) => {
  const ready = {
    type: "ready",
    threadId: "saved-thread",
    model: "gpt-6.1-sol",
    clients: 1,
    workdir: root,
    run: { state: "ready", label: "空闲" },
    history: [],
  };
  const { page, origin } = await boot(t, { thread: "saved-thread", ws: { readyPayloadByThread: { "saved-thread": ready } } });
  await page.waitForFunction(() => localStorage.getItem("codexPhoneThread") === "saved-thread");
  // Relaunch without a thread query param (as the native shell does).
  await page.goto(`${origin}/?token=${token}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#composer");
  await page.waitForTimeout(300);
  const url = await page.evaluate(() => window.__mockSockets[0]?.url || "");
  assert.match(url, /thread=saved-thread/);
});

test("queues a send while disconnected and flushes it on reconnect", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [{ type: "user", text: "离线提问内容" }],
      },
    },
  });
  await page.getByText("离线提问内容").first().waitFor();
  await page.evaluate(() => window.__closeMockSockets());
  await longPress(page, page.locator(".entry.user").first());
  await page.locator('.bottom-sheet .list-row:has-text("重试")').click();
  // Force a reconnect (the timer waits for the page to be visible).
  await page.evaluate(() => document.querySelector("#connect")?.click());
  await page.waitForFunction(
    () => (window.__sentFrames || []).some((f) => f.type === "prompt" && /离线提问内容/.test(f.text || "")),
    null,
    { timeout: 8000 },
  );
});

test("composer draft is scoped per thread and survives a switch", async (t) => {
  const readyFor = (id) => ({
    type: "ready",
    threadId: id,
    model: "gpt-6.1-sol",
    clients: 1,
    workdir: root,
    run: { state: "ready", label: "空闲" },
    history: [],
  });
  const { page } = await boot(t, {
    thread: "ta",
    apiState: {
      threads: [
        { id: "ta", name: "Thread A", updatedAt: Date.now() },
        { id: "tb", name: "Thread B", updatedAt: Date.now() },
      ],
    },
    ws: { readyPayloadByThread: { ta: readyFor("ta"), tb: readyFor("tb") } },
  });
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "ready");
  await page.fill("#prompt", "A 的草稿");
  await page.click("#mobileThreads");
  await page.waitForSelector(".drawer.open");
  await page.locator('.thread-item:has-text("Thread B")').click();
  await page.waitForTimeout(400);
  assert.equal(await page.inputValue("#prompt"), "", "B has no draft yet");
  await page.fill("#prompt", "B 的草稿");
  await page.click("#mobileThreads");
  await page.waitForSelector(".drawer.open");
  await page.locator('.thread-item:has-text("Thread A")').click();
  await page.waitForTimeout(400);
  assert.equal(await page.inputValue("#prompt"), "A 的草稿");
});

test("a rejected command surfaces a status chip and can restore its text", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [],
      },
    },
  });
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "ready");
  await page.fill("#prompt", "会被拒绝的内容");
  await page.click("#send");
  await page.waitForFunction(() => (window.__sentFrames || []).some((f) => f.type === "prompt" && f.commandId));
  const cmdId = await page.evaluate(() => (window.__sentFrames.find((f) => f.type === "prompt") || {}).commandId);
  await page.evaluate(
    (id) => window.__dispatchServerMessage({ type: "command.rejected", commandId: id, reason: "队列已满" }),
    cmdId,
  );
  await page.waitForSelector(".command-chip.command-rejected");
  assert.match(await page.locator(".command-chip.command-rejected").innerText(), /队列已满/);
  await page.locator(".command-chip.command-rejected .text-btn").click();
  assert.equal(await page.inputValue("#prompt"), "会被拒绝的内容");
});

test("send is disabled until the bridge reports ready", async (t) => {
  const { page } = await boot(t, { ws: { readyDelay: 5000 } });
  await page.waitForSelector("#send");
  assert.equal(await page.locator("#send").isDisabled(), true);
  assert.match(await page.locator("#prompt").getAttribute("placeholder"), /未连接/);
});

test("renders cached messages before the socket delivers a snapshot", async (t) => {
  const cached = [{ id: "hist:0", role: "user", status: "done", parts: [{ type: "text", text: "缓存的离线消息" }] }];
  const { page } = await boot(t, {
    thread: "thread-v2",
    ws: { readyDelay: 5000, seedCache: { "codexPhoneCache:thread-v2": JSON.stringify(cached) } },
  });
  await page.getByText("缓存的离线消息").first().waitFor({ timeout: 3000 });
});

test("in-thread search filters messages and shows a count", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [
          { type: "assistant", text: "alpha 唯一词" },
          { type: "assistant", text: "beta 普通" },
        ],
      },
    },
  });
  await page.getByText("alpha 唯一词").first().waitFor();
  assert.equal(await page.locator("#log .entry.assistant").count(), 2);
  await page.click("#searchButton2");
  await page.waitForSelector("#messageSearch");
  await page.fill("#messageSearch", "唯一词");
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#log .entry.assistant").count(), 1);
  assert.match(await page.locator(".message-search-count").innerText(), /1 条/);
});

test("native theme bridge overrides prefers-color-scheme for system pref", async (t) => {
  const { page } = await boot(t);
  // Default pref is system; the shell reports light.
  await page.evaluate(() => window.__nativeSystemTheme("light"));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.evaluate(() => window.__nativeSystemTheme("dark"));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  // An explicit user pref must not be overridden by the native signal.
  await page.evaluate(() => localStorage.setItem("codexPhoneTheme", "light"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#send");
  await page.evaluate(() => window.__nativeSystemTheme("dark"));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
});

test("composer grows with multi-line input", async (t) => {
  const { page } = await boot(t);
  const before = await page.locator("#prompt").evaluate((el) => el.getBoundingClientRect().height);
  await page.fill("#prompt", "line1\nline2\nline3\nline4\nline5\nline6");
  await page.waitForTimeout(150);
  const after = await page.locator("#prompt").evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(after > before, `expected growth: ${after} > ${before}`);
});

test("malicious image URLs never carry the token to a foreign origin", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [
          { type: "assistant", text: "![x](/api/file/raw/../../..//example.invalid/canary.png)\n\n![y](https://evil.invalid/pic.png)" },
        ],
      },
    },
  });
  await page.waitForSelector(".entry.assistant img");
  const srcs = await page.locator(".entry.assistant img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
  const pageOrigin = new URL(page.url()).origin;
  for (const src of srcs) {
    const u = new URL(src, page.url());
    // Invariant: the token may only ever appear on a same-origin URL.
    if (/[?&]token=/.test(src)) assert.equal(u.origin, pageOrigin, `credentials leaked to ${src}`);
  }
  // The protocol-relative path trick must not resolve to a foreign host.
  const tricky = srcs.find((s) => s.includes("example.invalid"));
  assert.ok(tricky, "expected the tricky src to render");
  assert.equal(new URL(tricky, page.url()).origin, pageOrigin);
});

test("snapshot restores in-flight message, tool, approvals and usage", async (t) => {
  const { page } = await boot(t);
  await page.evaluate(() => {
    window.__dispatchServerMessage({
      type: "history.snapshot",
      threadId: "thread-v2",
      seq: 5,
      messages: [{ type: "assistant", text: "历史回复" }],
      activeMessage: { messageId: "m-live", role: "assistant", text: "正在输出中" },
      activeTools: [{ toolCallId: "t1", kind: "command", name: "echo", input: { command: "echo hi" }, status: "running" }],
      approvals: [{ approvalId: 9, request: { id: 9, method: "item/commandExecution/requestApproval", params: {} } }],
      usage: { total: { totalTokens: 100, inputTokens: 80, outputTokens: 20 } },
      run: { state: "approval", label: "等待审批" },
    });
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".entry.assistant").count(), 2);
  assert.equal(await page.locator(".entry.tool .tool-card").count(), 1);
  assert.equal(await page.locator(".approval").count(), 1);
  assert.match(await page.locator(".usage-badge").innerText(), /↑/);
});

test("adopts the server thread id so reconnect resumes it", async (t) => {
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "new-A",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [],
      },
    },
  });
  await page.waitForFunction(() => document.querySelector("#runState")?.dataset.state === "ready");
  await page.evaluate(() => window.__closeMockSockets());
  await page.evaluate(() => document.querySelector("#connect")?.click());
  await page.waitForTimeout(400);
  const urls = await page.evaluate(() => window.__mockSockets.map((s) => s.url));
  assert.ok(urls.some((u) => /thread=new-A/.test(u)), JSON.stringify(urls));
});

test("markdown preserves code content, link queries, and c++ fences", async (t) => {
  const text = [
    "```js",
    "::selection{background: yellow;}",
    "```",
    "",
    "[link](https://example.com/?a=1&lang=zh)",
    "",
    "see __init__.py",
    "",
    "```c++",
    "int main(){}",
    "```",
  ].join("\n");
  const { page } = await boot(t, {
    ws: {
      defaultReadyPayload: {
        type: "ready",
        threadId: "thread-v2",
        model: "gpt-6.1-sol",
        clients: 1,
        workdir: root,
        run: { state: "ready", label: "空闲" },
        history: [{ type: "assistant", text }],
      },
    },
  });
  await page.waitForSelector(".entry.assistant");
  const body = page.locator(".entry.assistant .entry-body").first();
  const preText = await body.locator("pre").first().innerText();
  assert.match(preText, /::selection/);
  const href = await body.locator("a").first().getAttribute("href");
  assert.match(href, /lang=zh/);
  assert.doesNotMatch(href, /&amp;/);
  assert.equal(await body.locator('pre[data-language="c++"]').count(), 1);
  assert.match(await body.innerText(), /__init__\.py/);
});
