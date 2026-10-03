export const themeOptions = [
  { id: "simple", name: "简约", detail: "安静的本地面板" },
  { id: "cyberpunk", name: "赛博朋克", detail: "绿色终端文字 / 流动代码背景" },
  { id: "botanical", name: "植物", detail: "绿色 / 温暖的奶油色" },
  { id: "stigmata", name: "Stigmata", detail: "冰青 / 银白 / 红色贩卖机的余晖" },
];

export const accessModes = [
  { label: "完全访问", approvalPolicy: "never", sandboxMode: "danger-full-access" },
  { label: "确认模式", approvalPolicy: "on-request", sandboxMode: "workspace-write" },
  { label: "只读", approvalPolicy: "on-request", sandboxMode: "read-only" },
];

export const reasoningLevels = ["低", "中", "高", "极高"];

export const reasoningEffortValue = (level) =>
  ({ 低: "low", 中: "medium", 高: "high", 极高: "xhigh" })[level] || undefined;

export const modelChoices = [
  { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
  { id: "gpt-6-astra", label: "GPT-6-Astra" },
  { id: "gpt-6-sol", label: "GPT-6-Sol" },
  { id: "gpt-6-luna", label: "GPT-6-Luna" },
];

export function compactWorkspaceLocation(location) {
  const value = String(location || ".").replace(/\\/g, "/");
  if (value === "." || value === "~") return value;
  const prefix = value.startsWith("~/") ? "~/" : value.startsWith("/") ? "/" : "";
  const body = prefix ? value.slice(prefix.length) : value;
  const parts = body.split("/").filter(Boolean);
  if (parts.length <= 2) return value;
  return `${prefix}.../${parts.slice(-2).join("/")}`;
}
