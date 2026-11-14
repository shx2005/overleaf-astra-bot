import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingReviews,
  saveReview,
  acknowledgeReviews,
} from "../extension/reviews.js";
import {
  ExtensionReloadRequired,
  withExtensionContext,
} from "../extension/extension-context.js";

test("missing storage or invalidated runtime gives refresh guidance, never an empty history", async () => {
  for (const chrome of [
    { runtime: { id: "test" } },
    { runtime: {}, storage: { local: {} } },
    undefined,
  ]) {
    (globalThis as any).chrome = chrome;
    await assert.rejects(pendingReviews("project"), ExtensionReloadRequired);
    await assert.rejects(saveReview({} as any), ExtensionReloadRequired);
    await assert.rejects(
      acknowledgeReviews("project", ["id"]),
      ExtensionReloadRequired
    );
  }
});
test("invalidation between the preflight and asynchronous operation becomes a recoverable error", async () => {
  (globalThis as any).chrome = {
    runtime: { id: "test" },
    storage: { local: {} },
  };
  await assert.rejects(
    withExtensionContext(async () => {
      (globalThis as any).chrome.storage = undefined;
      throw new TypeError(
        "Cannot read properties of undefined (reading 'local')"
      );
    }),
    ExtensionReloadRequired
  );
});
test("ordinary storage failures are not mislabeled as extension updates", async () => {
  (globalThis as any).chrome = {
    runtime: { id: "test" },
    storage: { local: {} },
  };
  const error = new Error("QUOTA_BYTES quota exceeded");
  await assert.rejects(
    withExtensionContext(async () => {
      throw error;
    }),
    (actual) => actual === error
  );
});
