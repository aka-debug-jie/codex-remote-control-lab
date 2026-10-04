"use strict";

// Shared HTTP compression helpers (brotli/gzip) used by both the static file
// server and the JSON API responses.

const zlib = require("zlib");

const MIN_COMPRESS = 1024;

function pickEncoding(acceptEncoding) {
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

module.exports = { pickEncoding, compress, MIN_COMPRESS };
