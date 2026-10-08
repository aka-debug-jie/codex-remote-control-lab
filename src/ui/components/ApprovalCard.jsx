import React from "react";

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function fileList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" || (v && typeof v === "object"));
  return [];
}

// A single approval = the bridge accepting the decision is NOT the same as the
// upstream applying it. State transitions live in the store:
// requested -> submitting -> (server approval.resolved removes it | failed).
export function ApprovalCard({ approval, onDecision, allowAlways = true }) {
  const request = approval.request?.params ?? approval.request ?? {};
  const status = approval.status || "requested";
  const submitting = status === "submitting";
  const failed = status === "failed";

  const command = firstString(request.command, request.cmd, request.commandline);
  const cwd = firstString(request.cwd, request.workdir, request.params?.cwd);
  const files = fileList(request.changedFiles ?? request.files ?? request.params?.changedFiles)
    .map((f) => (typeof f === "string" ? f : f?.path || f?.name || ""))
    .filter(Boolean)
    .slice(0, 6);
  const reason = firstString(request.reason, request.justification, request.params?.reason);

  let badge = null;
  if (failed) badge = <span className="approval-badge error">提交失败：{approval.reason || "未知原因"}</span>;
  else if (submitting) badge = <span className="approval-badge">提交中，等待响应…</span>;

  return (
    <section className={`approval approval-${status}`}>
      <div className="approval-head">
        <strong>审批请求</strong>
        {badge}
      </div>
      <div className="approval-summary">
        {command ? (
          <div className="approval-field">
            <span>命令</span>
            <code>{command}</code>
          </div>
        ) : null}
        {cwd ? (
          <div className="approval-field">
            <span>目录</span>
            <code>{cwd}</code>
          </div>
        ) : null}
        {files.length ? (
          <div className="approval-field">
            <span>文件</span>
            <code>{files.join("、")}</code>
          </div>
        ) : null}
        {reason ? <p className="approval-reason">{reason}</p> : null}
      </div>
      <details className="approval-raw">
        <summary>原始请求</summary>
        <pre>{JSON.stringify(approval.request, null, 2)}</pre>
      </details>
      <div className="actions">
        <button type="button" className="secondary" disabled={submitting} onClick={() => onDecision(approval, "decline")}>
          拒绝
        </button>
        {allowAlways ? (
          <button type="button" className="secondary" disabled={submitting} onClick={() => onDecision(approval, "always")}>
            始终允许
          </button>
        ) : null}
        <button type="button" disabled={submitting} onClick={() => onDecision(approval, "accept")}>
          批准
        </button>
      </div>
    </section>
  );
}
