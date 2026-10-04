"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { pickEncoding, compress, MIN_COMPRESS } = require("./http-compress");

test("pickEncoding prefers brotli then gzip", () => {
  assert.equal(pickEncoding("gzip, deflate, br"), "br");
  assert.equal(pickEncoding("gzip, deflate"), "gzip");
  assert.equal(pickEncoding("identity"), null);
  assert.equal(pickEncoding(""), null);
  assert.equal(pickEncoding(undefined), null);
});

test("compress round-trips through brotli and gzip", () => {
  const source = Buffer.from(JSON.stringify({ hello: "world", n: 42 }), "utf8");
  const br = compress(source, "br");
  const gz = compress(source, "gzip");
  assert.deepEqual(zlib.brotliDecompressSync(br), source);
  assert.deepEqual(zlib.gunzipSync(gz), source);
  assert.ok(br.length < source.length || source.length < 32);
});

test("large JSON compresses substantially", () => {
  const source = Buffer.from(JSON.stringify({ items: Array.from({ length: 500 }, (_, i) => ({ i, name: `item-${i}` })) }), "utf8");
  assert.ok(source.length >= MIN_COMPRESS);
  const br = compress(source, "br");
  assert.ok(br.length < source.length * 0.4, `expected big reduction, got ${br.length}/${source.length}`);
});
