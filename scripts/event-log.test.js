"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventLog } = require("./event-log");

test("EventLog assigns monotonic seq and returns records with seq", () => {
  const log = new EventLog(10);
  const a = log.append({ type: "message.delta", delta: "a" });
  const b = log.append({ type: "message.delta", delta: "b" });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(log.lastSeq(), 2);
});

test("EventLog.since returns only events after the given seq", () => {
  const log = new EventLog(10);
  log.append({ type: "x" });
  log.append({ type: "y" });
  log.append({ type: "z" });
  assert.deepEqual(log.since(1).map((e) => e.type), ["y", "z"]);
  assert.deepEqual(log.since(3), []);
  assert.deepEqual(log.since(0).map((e) => e.seq), [1, 2, 3]);
});

test("EventLog trims to its limit while keeping seq monotonic", () => {
  const log = new EventLog(3);
  for (let i = 0; i < 5; i += 1) log.append({ type: "e", i });
  assert.equal(log.events.length, 3);
  assert.deepEqual(log.events.map((e) => e.i), [2, 3, 4]);
  assert.equal(log.lastSeq(), 5);
});
