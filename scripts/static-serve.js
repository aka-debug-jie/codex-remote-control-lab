"use strict";

// Static file serving for the phone UI with transport-level optimizations:
//   - on-the-fly brotli/gzip for compressible text assets (cached by path+mtime)
//   - tiered cache policy (immutable hashed assets vs revalidated shell)
//   - baseline security headers + Content-Security-Policy
// Kept dependency-free and side-effect free so it can be unit-tested.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MIME_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "application/javascript"],
  [".mjs", "application/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain"],
  [".map", "application/json"],
  [".ico", "image/x-icon"],
]);

const TEXT_EXT = new Set([".css", ".html", ".js", ".mjs", ".json", ".svg", ".webmanifest", ".txt", ".map"]);
const MIN_COMPRESS = 1024;

// sha256 of the inline theme-bootstrap <script> in src/ui/index.html.
// If that snippet changes, update this hash (a failing CSP shows a console
// error; the test suite also asserts the file's script hash matches).
const THEME_BOOTSTRAP_HASH = "sha256-1iZZDCCHtE7QADJDuJdm0zWOzyQnuK4fDjmUqVkZw4o=";

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' '${THEME_BOOTSTRAP_HASH}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

function cacheControlFor(requestPath) {
  if (requestPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  const base = path.basename(requestPath);
  if (base === "index.html" || base === "sw.js") return "no-cache";
  if (/\.(png|jpe?g|webp|gif|svg|ico|woff2)$/.test(base) || base === "site.webmanifest") {
    return "public, max-age=604800";
  }
  return "no-cache";
}

function pickEncoding(acceptEncoding, ext) {
  if (!TEXT_EXT.has(ext)) return null;
  const header = String(acceptEncoding || "").toLowerCase();
  if (header.includes("br")) return "br";
  if (header.includes("gzip")) return "gzip";
  return null;
}

function compress(buffer, encoding) {
  if (encoding === "br") {
    return zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
  }
  return zlib.gzipSync(buffer, { level: 6 });
}

function makeStaticServer({ publicRoot, extraHeaders } = {}) {
  const compressCache = new Map(); // `${path}:${mtimeMs}:${encoding}` -> Buffer
  const mimeFor = (ext) => MIME_TYPES.get(ext) || "application/octet-stream";

  function send(res, status, headers) {
    res.writeHead(status, { ...securityHeaders(), ...(extraHeaders || {}), ...headers });
  }

  return function serveStatic(req, res) {
    let parsed;
    try {
      parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    const requestPath = parsed.pathname;
    const file = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const target = path.join(publicRoot, file);
    if (!target.startsWith(`${publicRoot}${path.sep}`)) {
      send(res, 403);
      res.end("Forbidden");
      return;
    }

    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      send(res, 404);
      res.end("Not found");
      return;
    }
    if (!stat.isFile()) {
      send(res, 404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const type = mimeFor(ext);
    const cacheControl = cacheControlFor(requestPath);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

    if (req.headers["if-none-match"] === etag) {
      send(res, 304, { etag, "cache-control": cacheControl });
      res.end();
      return;
    }

    const encoding = pickEncoding(req.headers["accept-encoding"], ext);
    const baseHeaders = {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": cacheControl,
      etag,
      vary: "accept-encoding",
    };

    if (encoding && stat.size >= MIN_COMPRESS) {
      const key = `${target}:${Math.floor(stat.mtimeMs)}:${encoding}`;
      let body = compressCache.get(key);
      if (!body) {
        try {
          body = compress(fs.readFileSync(target), encoding);
          if (compressCache.size > 64) compressCache.clear();
          compressCache.set(key, body);
        } catch {
          body = null;
        }
      }
      if (body) {
        send(res, 200, { ...baseHeaders, "content-encoding": encoding, "content-length": body.length });
        res.end(body);
        return;
      }
    }

    send(res, 200, { ...baseHeaders, "content-length": stat.size });
    const stream = fs.createReadStream(target);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  };
}

module.exports = {
  makeStaticServer,
  securityHeaders,
  cacheControlFor,
  pickEncoding,
  MIME_TYPES,
  THEME_BOOTSTRAP_HASH,
};
