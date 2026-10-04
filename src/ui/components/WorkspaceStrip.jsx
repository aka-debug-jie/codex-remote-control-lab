import React from "react";
import { compactWorkspaceLocation } from "../lib/constants.js";

export function WorkspaceStrip({ meta }) {
  const hasMeta = Boolean(meta.repoName || meta.workspaceLocation || meta.gitBranch);
  return (
    <div id="workspaceIndicator" className={`workspace-strip${hasMeta ? "" : " empty"}`} aria-label="当前工作区">
      <div className="workspace-place">
        <span id="workspaceRepo" className="workspace-repo">{meta.repoName || "仓库"}</span>
        <span id="workspaceLocation" className="workspace-location">{compactWorkspaceLocation(meta.workspaceLocation || ".")}</span>
      </div>
      <div className="workspace-branch">
        <span className="branch-label">分支</span>
        <span id="branchName" className="branch-name">{meta.gitBranch || "未知"}</span>
      </div>
    </div>
  );
}
