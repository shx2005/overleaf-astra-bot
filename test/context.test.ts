import test from "node:test";
import assert from "node:assert/strict";
import { pdfBatchInput, commentInput } from "../host/context.js";

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
  assert.ok(input[1].text.includes("cannot stage or apply edits"));
  assert.ok(input[1].text.includes("Unable to activate requested file"));
  assert.deepEqual(commentInput(undefined), []);
});
