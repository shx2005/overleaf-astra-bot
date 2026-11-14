import test from "node:test";
import assert from "node:assert/strict";
import { pdfBatchInput, commentInput, commandInput } from "../host/context.js";

test("PDF page payloads contain all images in order and never extracted body text", () => {
  const pages = [1, 2, 3].map((page) => ({
    page,
    image: `/pdf/page-${page}.jpg`,
    text: "EXTRACTED_BODY_MUST_NOT_BE_SENT",
  }));
  const input = pdfBatchInput(pages, "2026-11-14", 3);
  assert.deepEqual(
    input.filter((item) => item.type === "localImage").map((item) => item.path),
    pages.map((page) => page.image)
  );
  assert.equal(input.filter((item) => item.type === "text").length, 1); // short batch instruction only
  assert.ok(!JSON.stringify(input).includes("EXTRACTED_BODY_MUST_NOT_BE_SENT"));
});
test("selected TeX is a dedicated text item, without repetition in anchor metadata", () => {
  const text = String.raw`Our result improves accuracy~\cite{smith}.`;
  const context = {
    selectedText: {
      text,
      filePath: "sec/intro.tex",
      from: 12,
      to: 55,
      verified: true,
    },
    anchorAvailable: true,
    anchor: { text, from: 12, to: 55 },
    editableRange: { text, filePath: "sec/intro.tex", from: 12, to: 55 },
  };
  const input = commentInput(context) as any[];
  assert.equal(input.length, 2);
  assert.equal(
    JSON.parse(input[0].text.split("\n").slice(1).join("\n")).text,
    text
  );
  const metadata = JSON.parse(input[1].text.split("\n").slice(1).join("\n"));
  assert.equal(metadata.anchor.text, undefined);
  assert.equal(metadata.editableRange.text, undefined);
  assert.equal(context.anchor.text, text); // does not mutate live context
});
test("unverified selection is still readable, with the actual failure and no edit authorization", () => {
  const input = commentInput({
    selectedText: { text: "Selected sentence.", verified: false },
    anchorAvailable: false,
    note: "Unable to activate requested file: sec/intro.tex",
  }) as any[];
  assert.ok(input[0].text.includes("Selected sentence."));
  const metadata = JSON.parse(input[1].text.split("\n").slice(1).join("\n"));
  assert.equal(metadata.anchorAvailable, false);
  assert.equal(metadata.editableRange, undefined);
  assert.ok(input[1].text.includes("Unable to activate requested file"));
  assert.deepEqual(commentInput(undefined), []);
});

test("turn data preserves accepted decisions and leaves an empty event delta empty", () => {
  const accepted = {
    id: "accepted-1",
    projectId: "project",
    proposalId: "turn:1",
    status: "accepted" as const,
    filePath: "intro.tex",
    oldText: "old",
    newText: "new",
    at: "2026-11-14T12:00:00Z",
  };
  const input = commandInput({
    request: "继续润色",
    requestedAt: "now",
    reviewEvents: [accepted],
  }) as any[];
  const data = JSON.parse(input[0].text.split("\n").slice(1).join("\n"));
  assert.equal(data.request, "继续润色");
  assert.equal(data.reviewEvents[0].status, "accepted");
  const next = commandInput({
    request: "回顾上次决定",
    requestedAt: "later",
    reviewEvents: [],
  }) as any[];
  assert.deepEqual(
    JSON.parse(next[0].text.split("\n").slice(1).join("\n")).reviewEvents,
    []
  );
  assert.equal(input.length, 1);
});
test("feedback is transmitted verbatim and associated with its review event", () => {
  const request = "保留引用，不要加强结论。\n这不是翻译任务。";
  const input = commandInput({
    request,
    requestedAt: "now",
    reviewEvents: [],
    feedbackReviewId: "decision-1",
  }) as any[];
  const task = JSON.parse(input[0].text.split("\n").slice(1).join("\n"));
  assert.equal(task.request, request);
  assert.equal(task.feedbackReviewId, "decision-1");
});
test("old browser range policies are removed while source, bounds and errors are preserved", () => {
  const original = {
    selectedText: { text: "word", verified: true },
    paragraph: { from: 10, to: 30, text: "whole paragraph" },
    editableRange: {
      from: 10,
      to: 30,
      text: "whole paragraph",
      policy: "OLD_CONFLICTING_RULE",
    },
    note: "useful diagnostic",
  };
  const input = commentInput(original) as any[];
  const context = JSON.parse(input[1].text.split("\n").slice(1).join("\n"));
  assert.equal(context.editableRange.policy, undefined);
  assert.equal(context.editableRange.from, 10);
  assert.equal(context.paragraph.text, "whole paragraph");
  assert.equal(context.note, "useful diagnostic");
  assert.equal(original.editableRange.policy, "OLD_CONFLICTING_RULE");
});

test("legacy context without a separate selection loses its policy but retains source text", () => {
  const input = commentInput({
    editableRange: {
      from: 0,
      to: 15,
      text: "Source retained",
      policy: "OLD_RULE",
    },
  }) as any[];
  const data = JSON.parse(input[0].text.split("\n").slice(1).join("\n"));
  assert.equal(data.editableRange.policy, undefined);
  assert.equal(data.editableRange.text, "Source retained");
});
