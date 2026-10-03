"use strict";

// Append-only, in-memory event log per bridge/thread.
// Provides a monotonic sequence number so clients can order events and detect
// gaps. Full-state reconciliation is done with `history.snapshot`, so stored
// events are only needed for ordering / optional short replay.
class EventLog {
  constructor(limit = 2000) {
    this.limit = Math.max(1, Number(limit) || 2000);
    this.events = [];
    this.seq = 0;
  }

  append(event = {}) {
    this.seq += 1;
    const record = { ...event, seq: this.seq };
    this.events.push(record);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    return record;
  }

  since(seq = 0) {
    const from = Number(seq) || 0;
    return this.events.filter((event) => event.seq > from);
  }

  lastSeq() {
    return this.seq;
  }

  clear() {
    this.events = [];
  }
}

module.exports = { EventLog };
