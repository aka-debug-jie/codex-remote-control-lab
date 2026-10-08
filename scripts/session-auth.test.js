const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSessionAuth, parseCookies, COOKIE_NAME, requestUsesHttps } = require("./session-auth");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-session-"));
  return path.join(dir, ".phone-session");
}

test("setCookieHeader is HttpOnly + Secure + SameSite=Strict + Path=/", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile() });
  const header = auth.setCookieHeader();
  assert.match(header, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=\d+/);
});

test("cookieMatches accepts the issued value and rejects others", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile() });
  const header = auth.setCookieHeader();
  const value = header.split(";")[0];
  assert.equal(auth.cookieMatches({ headers: { cookie: value } }), true);
  assert.equal(auth.cookieMatches({ headers: { cookie: `${value}; other=1` } }), true);
  assert.equal(auth.cookieMatches({ headers: { cookie: `${COOKIE_NAME}=wrong` } }), false);
  assert.equal(auth.cookieMatches({ headers: {} }), false);
  assert.equal(auth.cookieMatches({}), false);
});

test("cookieMatches rejects a same-length but different value (constant-time path)", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile() });
  const issued = auth.setCookieHeader().split(";")[0].split("=")[1];
  const tampered = `${issued.slice(0, -1)}${issued.at(-1) === "A" ? "B" : "A"}`;
  assert.equal(auth.cookieMatches({ headers: { cookie: `${COOKIE_NAME}=${tampered}` } }), false);
});

test("tokenMatches compares against the bridge token", () => {
  const auth = createSessionAuth({ token: "secret-token", persistedPath: tempFile() });
  assert.equal(auth.tokenMatches("secret-token"), true);
  assert.equal(auth.tokenMatches("wrong"), false);
  assert.equal(auth.tokenMatches(""), false);
  assert.equal(auth.tokenMatches(undefined), false);
});

test("session value persists across instances (survives restart)", () => {
  const file = tempFile();
  const a = createSessionAuth({ token: "t", persistedPath: file });
  const b = createSessionAuth({ token: "t", persistedPath: file });
  assert.equal(a.setCookieHeader(), b.setCookieHeader());
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("secure flag can be disabled for plain-http device testing", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile(), secure: false });
  assert.doesNotMatch(auth.setCookieHeader(), /Secure/);
});

test("Secure is per-request: HTTPS keeps it, plain HTTP (phone) drops it", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile() });
  // Default instance stays HTTPS-strict.
  assert.match(auth.setCookieHeader(), /Secure/);
  // Bridge is plain HTTP (Tailscale LAN http://100.x:45214) -> no Secure, so
  // WebView actually stores the cookie instead of rejecting it.
  assert.doesNotMatch(
    auth.setCookieHeader({ secure: false }),
    /Secure/,
    "plain HTTP request must not carry Secure",
  );
  // Proxied HTTPS keeps Secure.
  assert.match(
    auth.setCookieHeader({ secure: true }),
    /Secure/,
  );
});

test("requestUsesHttps honors x-forwarded-proto only", () => {
  assert.equal(requestUsesHttps({ headers: { "x-forwarded-proto": "https" } }), true);
  assert.equal(requestUsesHttps({ headers: { "x-forwarded-proto": "http,https" } }), false);
  assert.equal(requestUsesHttps({ headers: {} }), false);
  assert.equal(requestUsesHttps({}), false);
});

test("clearCookieHeader zeroes the cookie", () => {
  const auth = createSessionAuth({ token: "t", persistedPath: tempFile() });
  const header = auth.clearCookieHeader();
  assert.match(header, new RegExp(`^${COOKIE_NAME}=;`));
  assert.match(header, /Max-Age=0/);
});

test("parseCookies handles multiple cookies and URL-encoding", () => {
  const parsed = parseCookies("a=1; codex_session=x%2Fy; b=2");
  assert.equal(parsed.a, "1");
  assert.equal(parsed.b, "2");
  assert.equal(parsed[COOKIE_NAME], "x/y");
});

test("parseCookies tolerates malformed input", () => {
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies("no-equals; =; a=b"), { a: "b" });
});
