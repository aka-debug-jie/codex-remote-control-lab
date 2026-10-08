function bridgeKeyForRequest(threadId, connectionId) {
  if (threadId) return threadId;
  return "new:shared";
}

function shouldDisposeIdleBridge({ clientCount }) {
  return clientCount === 0;
}

function shouldPromoteBridgeKey({ bridgeKey, threadId }) {
  return Boolean(threadId && bridgeKey && bridgeKey !== threadId && bridgeKey.startsWith("new:"));
}

// Detach policy: leaving the phone must not mean the task dies.
//
// When the last client disconnects the bridge keeps living for `graceMs`; if a
// client returns within the window the timer is cancelled. On expiry a RUNNING
// task re-arms the timer (it still has somewhere to report to), and only an
// idle bridge is disposed. graceMs = 0 restores the legacy immediate dispose.
function createDetachPolicy({ graceMs = 0, isBusy, dispose, log = () => {} } = {}) {
  let timer = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = () => {
    if (!(graceMs > 0)) {
      log("detach: grace disabled, disposing now");
      dispose();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (isBusy()) {
        log(`detach: task still running after grace, keeping bridge alive (${graceMs}ms re-checks)`);
        arm();
        return;
      }
      log("detach: grace expired while idle, disposing bridge");
      dispose();
    }, graceMs);
  };
  return {
    clientGone() {
      clear();
      arm();
    },
    clientBack() {
      clear();
    },
    get pending() {
      return Boolean(timer);
    },
  };
}

module.exports = {
  bridgeKeyForRequest,
  shouldDisposeIdleBridge,
  shouldPromoteBridgeKey,
  createDetachPolicy,
};
