export type ContextUsage = {
  usedTokens?: number;
  contextWindow?: number;
  windowSource?: "codex" | "configured";
  configuredWindow?: number;
  autoCompactLimit?: number;
  compactLimitScope?: "total" | "body_after_prefix" | "unspecified";
  compacting?: boolean;
  updatedAt?: string;
  compactedAt?: string;
};
const count = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
export function presentContextUsage(usage: ContextUsage = {}, cached = false) {
  const used = usage.usedTokens;
  const window = usage.contextWindow;
  const limit = usage.autoCompactLimit;
  const percent =
    used !== undefined && window
      ? Math.round((used / window) * 100)
      : undefined;
  const comparable = usage.compactLimitScope !== "body_after_prefix";
  const remaining =
    used !== undefined && limit && comparable
      ? Math.max(0, limit - used)
      : undefined;
  const ratio =
    used !== undefined
      ? Math.max(
          window ? used / window : 0,
          limit && comparable ? used / limit : 0
        )
      : 0;
  const level = ratio >= 1 ? "full" : ratio >= 0.9 ? "near" : "normal";
  let label = usage.compacting
    ? "上下文 · compact 中…"
    : used === undefined
    ? "上下文：待统计"
    : `上下文 ≈${count(used)}${
        window ? ` / ${count(window)} · ${percent}%` : " tokens"
      }${cached ? "（上次）" : ""}`;
  if (!usage.compacting && used !== undefined) {
    if (remaining !== undefined)
      label += `\n${
        remaining === 0
          ? "已到配置 compact 阈值"
          : `距 compact 阈值 ≈${count(remaining)}`
      }`;
    else if (limit) label += `\ncompact 配置阈值 ${count(limit)}`;
    else if (level !== "normal") label += "\n接近上下文上限";
  }
  const detail = [
    "按 Codex 最近一次模型调用的 token 统计估算当前上下文；不是历次调用累计用量。",
    used === undefined
      ? "尚未收到用量统计。"
      : `最近一次：${used.toLocaleString("en-US")} tokens。`,
    window
      ? `窗口：${window.toLocaleString("en-US")}（${
          usage.windowSource === "codex"
            ? "Codex 返回值"
            : "本地配置值，非服务端容量保证"
        }）。`
      : "窗口上限未知。",
    usage.configuredWindow
      ? `本地窗口配置：${usage.configuredWindow.toLocaleString("en-US")}。`
      : "",
    limit
      ? `自动 compact 配置阈值：${limit.toLocaleString("en-US")}。${
          comparable
            ? "距离仅作参考，实际触发时机由 Codex 控制。"
            : "阈值按前缀后的正文统计，不能从总量精确推算剩余。"
        }`
      : "未读取到显式 compact 阈值，不猜测默认值。",
    usage.updatedAt
      ? `统计时间：${new Date(usage.updatedAt).toLocaleString("zh-CN")}。`
      : "",
    usage.compactedAt ? "本会话已收到 compact 完成事件。" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { label, detail, level };
}
