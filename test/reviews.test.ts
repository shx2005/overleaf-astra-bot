import test from "node:test";
import assert from "node:assert/strict";
import {
  saveReview,
  pendingReviews,
  acknowledgeReviews,
  validateReviews,
  newReviews,
  type ReviewEvent,
} from "../extension/reviews.js";
const project = "0123456789abcdef01234567";
const event = (id: string, projectId = project): ReviewEvent => ({
  id,
  projectId,
  proposalId: "turn:1",
  status: "accepted",
  filePath: "main.tex",
  oldText: "old",
  newText: "new",
  from: 12,
  at: "2026-11-14T01:00:00Z",
});
test("decisions persist per project; acknowledgement only removes delivered events", async () => {
  const data: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    runtime: { id: "test-extension" },
    storage: {
      local: {
        set: async (values: object) => Object.assign(data, values),
        get: async () => ({ ...data }),
        remove: async (keys: string[]) =>
          keys.forEach((key) => delete data[key]),
      },
    },
  };
  await Promise.all([
    saveReview(event("accepted")),
    saveReview({ ...event("rejected"), status: "rejected" }),
    saveReview(event("foreign", "fedcba9876543210fedcba98")),
  ]);
  const batch = await pendingReviews(project);
  assert.equal(batch.length, 2);
  await saveReview({
    ...event("feedback"),
    status: "rejected_with_feedback",
    feedback: "shorten it",
  });
  await acknowledgeReviews(
    project,
    batch.map((e) => e.id)
  );
  assert.deepEqual(
    (await pendingReviews(project)).map((e) => e.id),
    ["feedback"]
  );
  assert.equal((await pendingReviews("fedcba9876543210fedcba98")).length, 1);
});
test("host validates project and decisions, deduplicates acknowledged retries", () => {
  const events = [
    event("one"),
    {
      ...event("two"),
      status: "rejected_with_feedback",
      feedback: "keep the citation",
    },
  ];
  const valid = validateReviews(events, project);
  assert.deepEqual(
    newReviews(valid, ["one"]).map((e) => e.id),
    ["two"]
  );
  assert.throws(() => validateReviews([event("one", "other")], project));
  assert.throws(() => validateReviews([event("one"), event("one")], project));
  assert.throws(() =>
    validateReviews([{ ...event("one"), status: "pending" }], project)
  );
  assert.throws(() =>
    validateReviews(
      [{ ...event("one"), status: "rejected_with_feedback" }],
      project
    )
  );
});
