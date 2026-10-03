"use strict";

const { EventLog } = require("./event-log");

const DELTA_FLUSH_MS = 45;

// EventLog + client broadcast, with server-side coalescing of token-level
// `message.delta` events. Deltas are buffered per message and flushed on a
// short timer (or immediately when any other event arrives, preserving order).
class EventStream {
  constructor({ limit = 2000, flushMs = DELTA_FLUSH_MS } = {}) {
    this.log = new EventLog(limit);
    this.flushMs = flushMs;
    this.sink = null;
    this.pending = new Map();
    this.timer = null;
  }

  setSink(sink) {
    this.sink = sink;
  }

  lastSeq() {
    return this.log.lastSeq();
  }

  emit(event) {
    if (event && event.type === "message.delta") {
      this.pending.set(event.messageId, (this.pending.get(event.messageId) || "") + (event.delta || ""));
      if (this.timer == null) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, this.flushMs);
      }
      return;
    }
    this.flush();
    this.send(event);
  }

  flush() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending.size) return;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [messageId, delta] of entries) this.send({ type: "message.delta", messageId, delta });
  }

  send(event) {
    const record = this.log.append(event);
    if (this.sink) this.sink(record);
    return record;
  }

  dispose() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }
}

module.exports = { EventStream, DELTA_FLUSH_MS };
