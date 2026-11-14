import type { ContextUsage } from "../extension/context-usage.js";
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
export function usageWithConfig(
  previous: ContextUsage,
  config: any
): ContextUsage {
  const configuredWindow = positive(config?.model_context_window);
  return {
    ...previous,
    configuredWindow,
    contextWindow:
      previous.windowSource === "codex"
        ? previous.contextWindow
        : configuredWindow,
    windowSource:
      previous.windowSource === "codex"
        ? "codex"
        : configuredWindow
        ? "configured"
        : undefined,
    autoCompactLimit: positive(config?.model_auto_compact_token_limit),
    compactLimitScope:
      config?.model_auto_compact_token_limit_scope === "body_after_prefix"
        ? "body_after_prefix"
        : config?.model_auto_compact_token_limit_scope === "total"
        ? "total"
        : "unspecified",
  };
}
export function usageFromNotification(
  previous: ContextUsage,
  method: string,
  params: any,
  threadId: string
): ContextUsage | undefined {
  if (params?.threadId !== threadId) return;
  const now = new Date().toISOString();
  if (method === "thread/tokenUsage/updated") {
    const used = params.tokenUsage?.last?.totalTokens;
    if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0)
      return;
    const window = positive(params.tokenUsage?.modelContextWindow);
    return {
      ...previous,
      usedTokens: used,
      contextWindow: window ?? previous.contextWindow,
      windowSource: window ? "codex" : previous.windowSource,
      updatedAt: now,
    };
  }
  if (params?.item?.type === "contextCompaction") {
    if (method === "item/started") return { ...previous, compacting: true };
    if (method === "item/completed")
      return {
        ...previous,
        compacting: false,
        usedTokens: undefined,
        compactedAt: now,
      };
  }
}
