export const themeOptions = [
  { id: "system", name: "跟随系统", detail: "随系统深浅色自动切换" },
  { id: "light", name: "浅色", detail: "明亮的液态玻璃" },
  { id: "dark", name: "深色", detail: "沉浸的深空玻璃" },
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
