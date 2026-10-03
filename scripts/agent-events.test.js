"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCodexState,
  createClaudeState,
  normalizeCodexMessage,
  normalizeClaudeMessage,
  firstLine,
} = require("./agent-events");

function applyAll(normalize, state, messages) {
  const events = [];
  for (const message of messages) events.push(...normalize(message, state));
  return events;
}

test("codex: separate agent messages produce separate message.started/finished", () => {
  const state = createCodexState();
  state.turnId = "turn-1";
  const events = applyAll(normalizeCodexMessage, state, [
    { method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "第一段" } },
    { method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "内容" } },
    { method: "item/completed", params: { item: { type: "agentMessage", id: "msg-1", text: "第一段内容", phase: "commentary" } } },
    { method: "item/agentMessage/delta", params: { itemId: "msg-2", delta: "第二段" } },
    { method: "item/agentMessage/delta", params: { itemId: "msg-2", delta: "内容" } },
    { method: "item/completed", params: { item: { type: "agentMessage", id: "msg-2", text: "第二段内容", phase: "final" } } },
  ]);

  const started = events.filter((e) => e.type === "message.started");
  const finished = events.filter((e) => e.type === "message.finished");
  assert.deepEqual(started.map((e) => e.messageId), ["msg-1", "msg-2"]);
  assert.deepEqual(finished.map((e) => e.messageId), ["msg-1", "msg-2"]);
  assert.equal(finished[0].phase, "commentary");
  assert.equal(finished[1].phase, "final");

  const deltas1 = events.filter((e) => e.type === "message.delta" && e.messageId === "msg-1").map((e) => e.delta).join("");
  const deltas2 = events.filter((e) => e.type === "message.delta" && e.messageId === "msg-2").map((e) => e.delta).join("");
  assert.equal(deltas1, "第一段内容");
  assert.equal(deltas2, "第二段内容");
});

test("codex: commandExecution becomes tool.started/tool.finished with output metadata", () => {
  const state = createCodexState();
  state.turnId = "turn-1";
  const events = applyAll(normalizeCodexMessage, state, [
    {
      method: "item/started",
      params: { item: { type: "commandExecution", id: "exec-1", command: "/bin/bash -lc \"echo hi\"", cwd: "/work" } },
    },
    {
      method: "item/completed",
      params: {
        item: {
          type: "commandExecution",
          id: "exec-1",
          command: "/bin/bash -lc \"echo hi\"",
          status: "completed",
          aggregatedOutput: "hi\n",
          exitCode: 0,
          durationMs: 12,
        },
      },
    },
  ]);
  assert.deepEqual(events.map((e) => e.type), ["tool.started", "tool.finished"]);
  assert.equal(events[0].kind, "command");
  assert.equal(events[0].toolCallId, "exec-1");
  assert.match(events[0].name, /echo hi/);
  assert.equal(events[1].output, "hi\n");
  assert.equal(events[1].exitCode, 0);
});

test("codex: fileChange becomes a tool with a diff", () => {
  const state = createCodexState();
  state.turnId = "turn-1";
  const events = applyAll(normalizeCodexMessage, state, [
    { method: "item/started", params: { item: { type: "fileChange", id: "fc-1", status: "in_progress" } } },
    { method: "item/completed", params: { item: { type: "fileChange", id: "fc-1", status: "completed", diff: "--- a\n+++ b\n" } } },
  ]);
  assert.equal(events[0].type, "tool.started");
  assert.equal(events[0].kind, "fileChange");
  assert.equal(events[1].diff, "--- a\n+++ b\n");
});

test("codex: turn/completed produces run.finished and resets per-turn state", () => {
  const state = createCodexState();
  state.turnId = "turn-9";
  state.messageId = "msg-open";
  const events = normalizeCodexMessage({ method: "turn/completed", params: { turnId: "turn-9", turn: { status: "completed" } } }, state);
  assert.equal(events[0].type, "run.finished");
  assert.equal(events[0].turnId, "turn-9");
  assert.equal(state.messageId, null);
  assert.equal(state.turnId, null);
});

test("codex: error notification produces run.error", () => {
  const state = createCodexState();
  const events = normalizeCodexMessage({ method: "error", params: { error: { message: "boom", additionalDetails: "detail" } } }, state);
  assert.equal(events[0].type, "run.error");
  assert.equal(events[0].message, "boom");
});

test("claude: text deltas produce message lifecycle; result ends the run", () => {
  const state = createClaudeState();
  state.turnId = "turn-c";
  const events = applyAll(normalizeClaudeMessage, state, [
    { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "世界" } } },
    { type: "result", result: "你好世界" },
  ]);
  assert.equal(events[0].type, "message.started");
  const deltas = events.filter((e) => e.type === "message.delta").map((e) => e.delta).join("");
  assert.equal(deltas, "你好世界");
  assert.equal(events.at(-1).type, "run.finished");
});

test("claude: tool_use and tool_result map to tool events", () => {
  const state = createClaudeState();
  const events = applyAll(normalizeClaudeMessage, state, [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "file\n" }] } },
  ]);
  assert.equal(events[0].type, "tool.started");
  assert.equal(events[0].toolCallId, "tu-1");
  assert.equal(events[1].type, "tool.finished");
  assert.equal(events[1].output, "file\n");
});

test("firstLine truncates and keeps the first line", () => {
  assert.equal(firstLine("/bin/bash -lc \"echo hi\"\nsecond"), "/bin/bash -lc \"echo hi\"");
  assert.ok(firstLine("x".repeat(300)).length <= 120);
});
