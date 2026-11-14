import test from "node:test";
import assert from "node:assert/strict";
import { usageWithConfig, usageFromNotification } from "../host/usage.js";
import { presentContextUsage } from "../extension/context-usage.js";
const config = {
  model_context_window: 512000,
  model_auto_compact_token_limit: 460000,
};
test("context uses the latest call, not cumulative billable usage, and prefers reported window", () => {
  const usage = usageFromNotification(
    usageWithConfig({}, config),
    "thread/tokenUsage/updated",
    {
      threadId: "t",
      tokenUsage: {
        total: { totalTokens: 900000 },
        last: { totalTokens: 420000 },
        modelContextWindow: 486400,
      },
    },
    "t"
  )!;
  assert.equal(usage.usedTokens, 420000);
  assert.equal(usage.contextWindow, 486400);
  assert.equal(usage.windowSource, "codex");
  const display = presentContextUsage(usage);
  assert.match(display.label, /420k \/ 486.4k/);
  assert.match(display.label, /40k/);
  assert.equal(display.level, "near");
});
test("unknown usage or limits are not fabricated", () => {
  assert.equal(presentContextUsage().label, "上下文：待统计");
  assert.equal(
    usageFromNotification(
      {},
      "thread/tokenUsage/updated",
      { threadId: "t", tokenUsage: { total: { totalTokens: 999 } } },
      "t"
    ),
    undefined
  );
  assert.equal(
    usageFromNotification(
      {},
      "thread/tokenUsage/updated",
      { threadId: "other", tokenUsage: { last: { totalTokens: 99 } } },
      "t"
    ),
    undefined
  );
  assert.equal(usageWithConfig({}, {}).contextWindow, undefined);
});
test("compaction invalidates the previous high usage until the next token event", () => {
  const started = usageFromNotification(
    { usedTokens: 460000 },
    "item/started",
    { threadId: "t", item: { type: "contextCompaction" } },
    "t"
  )!;
  assert.match(presentContextUsage(started).label, /compact 中/);
  const ended = usageFromNotification(
    started,
    "item/completed",
    { threadId: "t", item: { type: "contextCompaction" } },
    "t"
  )!;
  assert.equal(ended.usedTokens, undefined);
  assert.equal(ended.compacting, false);
  assert.ok(ended.compactedAt);
  const fresh = usageFromNotification(
    ended,
    "thread/tokenUsage/updated",
    {
      threadId: "t",
      tokenUsage: { last: { totalTokens: 12000 }, modelContextWindow: 486400 },
    },
    "t"
  )!;
  assert.equal(fresh.usedTokens, 12000);
});
test("body-only compact thresholds are shown without a false remaining-token estimate", () => {
  const usage = usageWithConfig(
    { usedTokens: 420000 },
    { ...config, model_auto_compact_token_limit_scope: "body_after_prefix" }
  );
  const display = presentContextUsage(usage, true);
  assert.ok(!display.label.includes("距 compact"));
  assert.match(display.label, /上次/);
  assert.match(display.detail, /不能从总量精确推算/);
});
test("configured fallback is labeled and a full window is highlighted", () => {
  const usage = usageWithConfig({ usedTokens: 520000 }, config);
  assert.match(presentContextUsage(usage).detail, /本地配置值/);
  assert.equal(presentContextUsage(usage).level, "full");
});
