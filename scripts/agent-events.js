"use strict";

// Translates raw provider events (codex app-server JSON-RPC methods, claude
// stream-json lines) into the normalized phone event protocol (v2).
//
// Event types emitted:
//   run.started / run.finished / run.error
//   message.started / message.delta / message.finished
//   reasoning.started / reasoning.delta / reasoning.finished
//   tool.started / tool.finished
//   approval.requested / approval.resolved
//   status
// `seq` is assigned by the bridge via EventLog.append, not here.

const EVENT_TYPES = Object.freeze({
  RUN_STARTED: "run.started",
  RUN_FINISHED: "run.finished",
  RUN_ERROR: "run.error",
  MESSAGE_STARTED: "message.started",
  MESSAGE_DELTA: "message.delta",
  MESSAGE_FINISHED: "message.finished",
  REASONING_STARTED: "reasoning.started",
  REASONING_DELTA: "reasoning.delta",
  REASONING_FINISHED: "reasoning.finished",
  TOOL_STARTED: "tool.started",
  TOOL_FINISHED: "tool.finished",
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_RESOLVED: "approval.resolved",
  USAGE_UPDATED: "usage.updated",
  STATUS: "status",
});

function firstLine(value) {
  const text = String(value || "").trim();
  const line = text.split(/\r?\n/)[0] || "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

const MAX_TOOL_OUTPUT = 16000;

function clampOutput(value, max = MAX_TOOL_OUTPUT) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[输出已截断，共 ${text.length} 字符]`;
}

function createCodexState() {
  return { turnId: null, messageId: null, reasoningId: null };
}

function createClaudeState() {
  return { turnId: null, messageId: null, messageText: "", messageCounter: 0, toolName: null, reasoningId: null };
}

// codex app-server notifications -> normalized events.
function normalizeCodexMessage(msg, state) {
  const events = [];
  const params = msg?.params || {};
  const method = msg?.method;

  if (method === "item/agentMessage/delta") {
    const messageId = params.itemId || state.messageId || `turn:${state.turnId || "unknown"}`;
    if (state.messageId !== messageId) {
      state.messageId = messageId;
      events.push({ type: EVENT_TYPES.MESSAGE_STARTED, messageId, role: "assistant", turnId: state.turnId });
    }
    events.push({ type: EVENT_TYPES.MESSAGE_DELTA, messageId, delta: params.delta || "" });
    return events;
  }

  if (method === "item/reasoning/delta" || method === "item/reasoningText/delta") {
    const messageId = params.itemId || state.reasoningId || `reasoning:${state.turnId || "unknown"}`;
    if (state.reasoningId !== messageId) {
      state.reasoningId = messageId;
      events.push({ type: EVENT_TYPES.REASONING_STARTED, messageId });
    }
    events.push({ type: EVENT_TYPES.REASONING_DELTA, messageId, delta: params.delta || "" });
    return events;
  }

  if (method === "item/started") {
    const item = params.item || {};
    if (item.type === "agentMessage") {
      state.messageId = item.id || state.messageId;
      events.push({
        type: EVENT_TYPES.MESSAGE_STARTED,
        messageId: state.messageId,
        role: "assistant",
        turnId: state.turnId,
        phase: item.phase || null,
      });
    } else if (item.type === "reasoning") {
      state.reasoningId = item.id || state.reasoningId;
      events.push({ type: EVENT_TYPES.REASONING_STARTED, messageId: state.reasoningId });
    } else if (item.type === "commandExecution") {
      events.push({
        type: EVENT_TYPES.TOOL_STARTED,
        toolCallId: item.id,
        kind: "command",
        name: firstLine(item.command),
        input: { command: item.command || "", cwd: item.cwd || "" },
      });
    } else if (item.type === "fileChange") {
      events.push({
        type: EVENT_TYPES.TOOL_STARTED,
        toolCallId: item.id,
        kind: "fileChange",
        name: "文件改动",
        input: { status: item.status || "" },
      });
    }
    return events;
  }

  if (method === "item/completed") {
    const item = params.item || {};
    if (item.type === "agentMessage") {
      const messageId = item.id || state.messageId || `turn:${state.turnId || "unknown"}`;
      if (state.messageId !== messageId) {
        events.push({
          type: EVENT_TYPES.MESSAGE_STARTED,
          messageId,
          role: "assistant",
          turnId: state.turnId,
          phase: item.phase || null,
        });
      }
      events.push({
        type: EVENT_TYPES.MESSAGE_FINISHED,
        messageId,
        text: item.text || "",
        phase: item.phase || null,
      });
      state.messageId = null;
    } else if (item.type === "reasoning") {
      const messageId = item.id || state.reasoningId || `reasoning:${state.turnId || "unknown"}`;
      events.push({
        type: EVENT_TYPES.REASONING_FINISHED,
        messageId,
        text: item.text || item.summary || "",
      });
      if (state.reasoningId === messageId) state.reasoningId = null;
    } else if (item.type === "commandExecution") {
      events.push({
        type: EVENT_TYPES.TOOL_FINISHED,
        toolCallId: item.id,
        kind: "command",
        status: item.status || "completed",
        output: clampOutput(item.aggregatedOutput),
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
      });
    } else if (item.type === "fileChange") {
      events.push({
        type: EVENT_TYPES.TOOL_FINISHED,
        toolCallId: item.id,
        kind: "fileChange",
        status: item.status || "completed",
        diff: item.diff || item.patch || "",
      });
    }
    return events;
  }

  if (method === "thread/tokenUsage/updated") {
    const usage = params.tokenUsage || {};
    events.push({ type: EVENT_TYPES.USAGE_UPDATED, total: usage.total || null, last: usage.last || null });
    return events;
  }

  if (method === "turn/completed") {
    const turn = params.turn || {};
    const durationMs =
      turn.startedAt && turn.completedAt ? Math.max(0, (turn.completedAt - turn.startedAt) * 1000) : null;
    events.push({
      type: EVENT_TYPES.RUN_FINISHED,
      turnId: params.turnId || turn.id || state.turnId,
      status: turn.status || "completed",
      durationMs,
    });
    state.turnId = null;
    state.messageId = null;
    state.reasoningId = null;
    return events;
  }

  if (method === "error") {
    const error = params.error || params;
    events.push({
      type: EVENT_TYPES.RUN_ERROR,
      message: error.message || params.message || "Codex error",
      detail: error.additionalDetails || error.codexErrorInfo || null,
    });
    return events;
  }

  return events;
}

// claude stream-json lines -> normalized events.
function normalizeClaudeMessage(msg, state) {
  const events = [];
  if (!msg || typeof msg !== "object") return events;

  if (msg.type === "system" && msg.subtype === "init") {
    events.push({ type: EVENT_TYPES.STATUS, text: `Claude session ready: ${msg.session_id || ""}`.trim() });
    return events;
  }

  const event = msg.type === "stream_event" ? msg.event : null;
  if (event && event.type === "content_block_start") {
    const block = event.content_block || {};
    if (block.type === "text") {
      state.messageCounter += 1;
      state.messageId = `claude:${state.turnId || "turn"}:${state.messageCounter}`;
      state.messageText = "";
      events.push({ type: EVENT_TYPES.MESSAGE_STARTED, messageId: state.messageId, role: "assistant", turnId: state.turnId });
    } else if (block.type === "reasoning") {
      state.reasoningId = `reasoning:${state.turnId || "turn"}:${state.messageCounter}`;
      events.push({ type: EVENT_TYPES.REASONING_STARTED, messageId: state.reasoningId });
    } else if (block.type === "tool_use") {
      state.toolName = block.name || "tool";
      events.push({
        type: EVENT_TYPES.TOOL_STARTED,
        toolCallId: block.id || `tool:${state.toolName}`,
        kind: "command",
        name: state.toolName,
        input: {},
      });
    }
    return events;
  }

  if (event && event.type === "content_block_delta") {
    const delta = event.delta || {};
    if (delta.type === "text_delta" && state.messageId) {
      state.messageText = `${state.messageText || ""}${delta.text || ""}`;
      events.push({ type: EVENT_TYPES.MESSAGE_DELTA, messageId: state.messageId, delta: delta.text || "" });
    } else if ((delta.type === "thinking_delta" || delta.type === "reasoning_delta") && state.reasoningId) {
      events.push({ type: EVENT_TYPES.REASONING_DELTA, messageId: state.reasoningId, delta: delta.thinking || delta.text || "" });
    }
    return events;
  }

  if (event && event.type === "content_block_stop") {
    if (state.reasoningId) {
      events.push({ type: EVENT_TYPES.REASONING_FINISHED, messageId: state.reasoningId, text: "" });
      state.reasoningId = null;
    }
    if (state.messageId) {
      events.push({ type: EVENT_TYPES.MESSAGE_FINISHED, messageId: state.messageId, text: state.messageText || "" });
      state.messageId = null;
      state.messageText = "";
    }
    return events;
  }

  if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block?.type === "text" && block.text && state.messageId) {
        events.push({ type: EVENT_TYPES.MESSAGE_FINISHED, messageId: state.messageId, text: block.text });
        state.messageId = null;
      } else if (block?.type === "tool_use") {
        events.push({
          type: EVENT_TYPES.TOOL_STARTED,
          toolCallId: block.id,
          kind: "command",
          name: block.name || "tool",
          input: block.input || {},
        });
      }
    }
    return events;
  }

  if (msg.type === "user" && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block?.type === "tool_result") {
        events.push({
          type: EVENT_TYPES.TOOL_FINISHED,
          toolCallId: block.tool_use_id,
          kind: "command",
          status: block.is_error ? "failed" : "completed",
          output: typeof block.content === "string" ? clampOutput(block.content) : "",
          exitCode: block.is_error ? 1 : 0,
        });
      }
    }
    return events;
  }

  if (msg.type === "result") {
    events.push({ type: EVENT_TYPES.RUN_FINISHED, turnId: state.turnId, status: "completed" });
    state.turnId = null;
    state.messageId = null;
    state.reasoningId = null;
    return events;
  }

  return events;
}

module.exports = {
  EVENT_TYPES,
  createCodexState,
  createClaudeState,
  normalizeCodexMessage,
  normalizeClaudeMessage,
  firstLine,
  clampOutput,
  MAX_TOOL_OUTPUT,
};
