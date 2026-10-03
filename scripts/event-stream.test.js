"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventStream } = require("./event-stream");

function collect(stream) {
  const received = [];
  stream.setSink((record) => received.push(record));
  return received;
}

test("coalesces consecutive message.delta events into one broadcast", () => {
  const stream = new EventStream({ flushMs: 10_000 });
  const received = collect(stream);
  stream.emit({ type: "message.delta", messageId: "m1", delta: "你" });
  stream.emit({ type: "message.delta", messageId: "m1", delta: "好" });
  assert.equal(received.length, 0, "deltas are buffered, not sent immediately");
  stream.flush();
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "message.delta");
  assert.equal(received[0].messageId, "m1");
  assert.equal(received[0].delta, "你好");
  assert.equal(received[0].seq, 1);
});

test("a non-delta event flushes pending deltas first, preserving order", () => {
  const stream = new EventStream({ flushMs: 10_000 });
  const received = collect(stream);
  stream.emit({ type: "message.delta", messageId: "m1", delta: "a" });
  stream.emit({ type: "message.finished", messageId: "m1", text: "ab" });
  assert.deepEqual(
    received.map((e) => e.type),
    ["message.delta", "message.finished"],
  );
  assert.deepEqual(
    received.map((e) => e.seq),
    [1, 2],
  );
});

test("deltas for different messages are kept separate", () => {
  const stream = new EventStream({ flushMs: 10_000 });
  const received = collect(stream);
  stream.emit({ type: "message.delta", messageId: "m1", delta: "one" });
  stream.emit({ type: "message.delta", messageId: "m2", delta: "two" });
  stream.flush();
  const byId = Object.fromEntries(received.map((e) => [e.messageId, e.delta]));
  assert.deepEqual(byId, { m1: "one", m2: "two" });
});

test("flush timer eventually broadcasts buffered deltas", async () => {
  const stream = new EventStream({ flushMs: 5 });
  const received = collect(stream);
  stream.emit({ type: "message.delta", messageId: "m1", delta: "x" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(received.length, 1);
  assert.equal(received[0].delta, "x");
  stream.dispose();
});
