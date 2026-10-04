import React from "react";

export function ApprovalCard({ approval, onDecision }) {
  return (
    <section className="approval">
      <div>
        <strong>审批请求</strong>
        <pre>{JSON.stringify(approval.request?.params ?? approval.request, null, 2)}</pre>
      </div>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => onDecision(approval, "decline")}>
          拒绝
        </button>
        <button type="button" className="secondary" onClick={() => onDecision(approval, "always")}>
          始终允许
        </button>
        <button type="button" onClick={() => onDecision(approval, "accept")}>
          批准
        </button>
      </div>
    </section>
  );
}
