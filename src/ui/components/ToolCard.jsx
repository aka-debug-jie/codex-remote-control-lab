import React from "react";
import { highlightCode } from "../lib/markdown.js";

export function ToolCard({ part }) {
  const running = part.status === "running";
  const exit = part.exitCode;
  const output = part.output || "";
  const diff = part.diff || "";
  return (
    <div className={`tool-card${running ? " running" : ""}`}>
      <div className="tool-card-head">
        <span className={`tool-kind tool-kind-${part.kind || "tool"}`}>{part.kind === "fileChange" ? "DIFF" : "CMD"}</span>
        <span className="tool-name">{part.name || "工具"}</span>
        {exit != null && exit !== 0 ? <span className="tool-exit bad">exit {exit}</span> : null}
        {running ? <span className="tool-exit run">运行中</span> : null}
        {part.durationMs ? <span className="tool-duration">{part.durationMs}ms</span> : null}
      </div>
      {part.input?.command ? <pre className="tool-command">{part.input.command}</pre> : null}
      {output ? (
        <details className="tool-output">
          <summary>输出</summary>
          <pre>{output}</pre>
        </details>
      ) : null}
      {diff ? (
        <details className="tool-output">
          <summary>差异</summary>
          <pre dangerouslySetInnerHTML={{ __html: highlightCode(diff, "diff") }} />
        </details>
      ) : null}
    </div>
  );
}
