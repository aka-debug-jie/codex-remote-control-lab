"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");

const {
  makeStaticServer,
  cacheControlFor,
  pickEncoding,
  securityHeaders,
  THEME_BOOTSTRAP_HASH,
} = require("./static-serve");

function startServer(publicRoot) {
  const serve = makeStaticServer({ publicRoot });
  const server = http.createServer((req, res) => serve(req, res));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(d)) })
    );
  });
}

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "static-serve-"));
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><div>hi</div>");
  fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "const x=1;".repeat(400));
  fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg/>".repeat(300));
  return dir;
}

test("cacheControlFor: hashed assets are immutable, shell revalidates", () => {
  assert.match(cacheControlFor("/assets/app-abc.js"), /immutable/);
  assert.equal(cacheControlFor("/index.html"), "no-cache");
  assert.equal(cacheControlFor("/sw.js"), "no-cache");
  assert.match(cacheControlFor("/icon-192.png"), /max-age=604800/);
});

test("pickEncoding: prefers br, falls back to gzip, skips binary", () => {
  assert.equal(pickEncoding("gzip, deflate, br", ".js"), "br");
  assert.equal(pickEncoding("gzip, deflate", ".js"), "gzip");
  assert.equal(pickEncoding("gzip", ".png"), null);
});

test("securityHeaders: CSP pins the theme bootstrap hash", () => {
  const csp = securityHeaders()["content-security-policy"];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, new RegExp(`script-src 'self' '${THEME_BOOTSTRAP_HASH.replace(/\+/g, "\\+")}'`));
  assert.equal(securityHeaders()["x-content-type-options"], "nosniff");
});

test("theme bootstrap hash in index.html matches the CSP hash", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html has an inline bootstrap script");
  const crypto = require("node:crypto");
  const hash = "sha256-" + crypto.createHash("sha256").update(match[1], "utf8").digest("base64");
  assert.equal(hash, THEME_BOOTSTRAP_HASH);
});

test("serves brotli-compressed JS with content-encoding + vary", async () => {
  const dir = tmpRoot();
  const srv = await startServer(dir);
  try {
    const res = await fetch(`${srv.origin}/assets/app-abc123.js`, { headers: { "accept-encoding": "br" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), "br");
    assert.match(res.headers.get("cache-control"), /immutable/);
    assert.equal(res.headers.get("vary"), "accept-encoding");
    // Node fetch transparently decodes br/gzip, so the body is plain text here.
    const body = await res.text();
    assert.match(body, /const x=1;/);
  } finally {
    await srv.close();
  }
});

test("serves gzip when brotli is not accepted", async () => {
  const dir = tmpRoot();
  const srv = await startServer(dir);
  try {
    const res = await fetch(`${srv.origin}/assets/app-abc123.js`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(res.headers.get("content-encoding"), "gzip");
  } finally {
    await srv.close();
  }
});

test("security headers are present on 200 and 304", async () => {
  const dir = tmpRoot();
  const srv = await startServer(dir);
  try {
    const first = await fetch(`${srv.origin}/index.html`);
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    assert.match(first.headers.get("content-security-policy"), /worker-src 'self'/);
    const etag = first.headers.get("etag");
    const second = await fetch(`${srv.origin}/index.html`, { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await srv.close();
  }
});

test("directory and traversal are rejected", async () => {
  const dir = tmpRoot();
  const srv = await startServer(dir);
  try {
    const dirRes = await fetch(`${srv.origin}/assets/`);
    assert.equal(dirRes.status, 404);
    const trav = await fetch(`${srv.origin}/..%2f..%2fpackage.json`);
    assert.ok([403, 404].includes(trav.status));
  } finally {
    await srv.close();
  }
});
