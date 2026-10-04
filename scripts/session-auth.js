"use strict";

// Cookie-based session auth for the phone bridge.
//
// Threat model: the bridge token in the URL leaks through screenshots, share
// sheets, history and logs. After a one-time token exchange the client keeps a
// random HttpOnly session cookie instead, so injected scripts cannot read the
// credential and the token never lingers in the address bar.
//
// The raw bridge token still works (transitional / CLI / curl use); the cookie
// is an additive, same-origin, HttpOnly path.

const fs = require("fs");
const crypto = require("crypto");

const COOKIE_NAME = "codex_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function loadOrCreateSessionValue(persistedPath) {
  if (persistedPath) {
    try {
      const existing = fs.readFileSync(persistedPath, "utf8").trim();
      if (existing) return existing;
    } catch {
      /* fall through to creation */
    }
  }
  const value = crypto.randomBytes(32).toString("base64url");
  if (persistedPath) {
    try {
      fs.writeFileSync(persistedPath, `${value}\n`, { mode: 0o600 });
    } catch {
      /* non-fatal: sessions just won't survive a restart */
    }
  }
  return value;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSessionAuth({ token, persistedPath, secure = true, maxAge = DEFAULT_MAX_AGE } = {}) {
  const sessionValue = loadOrCreateSessionValue(persistedPath);

  function setCookieHeader() {
    const attrs = [
      `${COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
    ];
    if (secure) attrs.push("Secure");
    return attrs.join("; ");
  }

  function clearCookieHeader() {
    const attrs = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
    if (secure) attrs.push("Secure");
    return attrs.join("; ");
  }

  return {
    cookieName: COOKIE_NAME,
    setCookieHeader,
    clearCookieHeader,
    // Does this request carry a valid session cookie?
    cookieMatches(req) {
      const cookies = parseCookies(req.headers && req.headers.cookie);
      return safeEqual(cookies[COOKIE_NAME] || "", sessionValue);
    },
    // Does the provided token match the bridge token?
    tokenMatches(candidate) {
      return Boolean(candidate) && safeEqual(candidate, token);
    },
  };
}

module.exports = { createSessionAuth, parseCookies, COOKIE_NAME };
