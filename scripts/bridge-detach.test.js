const test = require("node:test");
const assert = require("node:assert/strict");
const { createDetachPolicy } = require("./bridge-state");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("detach: bridge survives the grace window when a client returns", async () => {
  let disposed = 0;
  const policy = createDetachPolicy({ graceMs: 50, isBusy: () => false, dispose: () => disposed++ });
  policy.clientGone();
  assert.equal(policy.pending, true, "expiry timer armed");
  policy.clientBack();
  assert.equal(policy.pending, false, "timer cancelled by returning client");
  await wait(120);
  assert.equal(disposed, 0, "returning before grace expiry keeps the bridge");
});

test("detach: idle bridge is disposed after the grace window", async () => {
  let disposed = 0;
  const policy = createDetachPolicy({ graceMs: 30, isBusy: () => false, dispose: () => disposed++ });
  policy.clientGone();
  await wait(100);
  assert.equal(disposed, 1);
  assert.equal(policy.pending, false);
});

test("detach: a busy task keeps the bridge alive past the first expiry, then disposes when idle", async () => {
  let disposed = 0;
  let busy = true;
  const policy = createDetachPolicy({ graceMs: 25, isBusy: () => busy, dispose: () => disposed++ });
  policy.clientGone();
  await wait(90);
  assert.equal(disposed, 0, "running task survives detached");
  busy = false;
  await wait(90);
  assert.equal(disposed, 1, "disposed on the next re-check once idle");
  assert.equal(policy.pending, false);
});

test("detach: grace disabled (0) disposes immediately", () => {
  let disposed = 0;
  const policy = createDetachPolicy({ graceMs: 0, isBusy: () => true, dispose: () => disposed++ });
  policy.clientGone();
  assert.equal(disposed, 1, "legacy kill-on-disconnect available via PHONE_DETACH_GRACE_MS=0");
  assert.equal(policy.pending, false);
});
