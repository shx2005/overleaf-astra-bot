import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorFromElement,
  sourceContext,
  type CommentAnchor,
} from "../extension/comment-context.js";
const base: CommentAnchor = {
  docId: "0123456789abcdef01234567",
  threadId: "thread",
  from: 0,
  text: "Target",
  draft: false,
};
test("comment anchor comes from its own React operation across shadow root", () => {
  const entry = {
    __reactFiber$test: {
      memoizedProps: {
        docId: base.docId,
        op: { t: "thread", p: 42, c: "anchored" },
      },
    },
  };
  const input = { getRootNode: () => ({ host: entry }) };
  assert.deepEqual(anchorFromElement(input as any), {
    ...base,
    from: 42,
    text: "anchored",
  });
  assert.equal(anchorFromElement({} as any), undefined);
  (entry.__reactFiber$test.memoizedProps as any).selectLineOnFocus = false;
  assert.equal(anchorFromElement(input as any)?.draft, true);
});
test("context attaches verified source, section hierarchy and surrounding paragraphs", () => {
  const source =
    "\\section{Methods}\n\\subsection{Training}\n% \\section{Fake}\nPrevious paragraph.\n\nTarget paragraph.\n\nFollowing paragraph.\n\nLater.";
  const result = sourceContext(
    source,
    { ...base, from: source.indexOf("Target") },
    "sections/methods.tex"
  );
  assert.equal(result.anchorAvailable, true);
  assert.deepEqual(result.section, ["Methods", "Training"]);
  assert.ok(result.before?.includes("Previous paragraph."));
  assert.ok(result.after?.includes("Following paragraph."));
  assert.equal(result.filePath, "sections/methods.tex");
});
test("stale or detached anchors never fall back to matching text elsewhere", () => {
  const result = sourceContext("Different\n\nTarget", base, "main.tex");
  assert.equal(result.anchorAvailable, false);
  assert.equal(result.anchor, undefined);
  assert.equal(
    sourceContext("Target", { ...base, text: "" }, "main.tex").anchorAvailable,
    false
  );
});

test("an anchor inside the section heading still includes that section", () => {
  const source = "\\section{Introduction Test}\nBody\n\\section{Later}";
  const result = sourceContext(
    source,
    { ...base, from: source.indexOf("Test"), text: "Test" },
    "main.tex"
  );
  assert.deepEqual(result.section, ["Introduction Test"]);
});

test("rebases a stale comment after an accepted edit before it", async () => {
  const { rebaseAnchor } = await import("../extension/comment-context.js");
  const source = "Before changed sentence.\n\nTarget sentence remains.";
  const anchor = { ...base, from: 25, text: "Target sentence remains." };
  const result = rebaseAnchor(
    source,
    anchor,
    [
      {
        filePath: "main.tex",
        from: 0,
        oldText: "Before sentence.",
        newText: "Before changed sentence.",
        at: "2026-11-14T01:00:00Z",
      },
    ],
    "main.tex"
  );
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.anchor?.from, source.indexOf("Target"));
  assert.equal(
    source.slice(
      result.anchor!.from,
      result.anchor!.from + result.anchor!.text.length
    ),
    result.anchor!.text
  );
});
test("rebases a selection contained in an accepted sentence replacement when the selected words survive", async () => {
  const { rebaseAnchor } = await import("../extension/comment-context.js");
  const source = "Evidence supports this method.";
  const anchor = { ...base, from: 5, text: "method" };
  const result = rebaseAnchor(
    source,
    anchor,
    [
      {
        filePath: "main.tex",
        from: 0,
        oldText: "This method is good.",
        newText: "Evidence supports this method.",
        at: "2026-11-14T01:00:00Z",
      },
    ],
    "main.tex"
  );
  assert.equal(result.ok, true);
  assert.equal(result.anchor?.text, "method");
  assert.equal(
    source.slice(result.anchor!.from, result.anchor!.from + 6),
    "method"
  );
});
test("does not guess when an accepted replacement destroys the selected anchor", async () => {
  const { rebaseAnchor } = await import("../extension/comment-context.js");
  const result = rebaseAnchor(
    "new phrase.",
    { ...base, from: 0, text: "old word" },
    [
      {
        filePath: "main.tex",
        from: 0,
        oldText: "old word",
        newText: "new phrase",
        at: "2026-11-14T01:00:00Z",
      },
    ],
    "main.tex"
  );
  assert.equal(result.ok, true);
  assert.equal(result.anchor?.text, "new phrase");
  const failed = rebaseAnchor(
    "Different.",
    { ...base, from: 0, text: "old word" },
    [
      {
        filePath: "main.tex",
        from: 0,
        oldText: "old word",
        newText: "new phrase",
        at: "2026-11-14T01:00:00Z",
      },
    ],
    "main.tex"
  );
  assert.equal(failed.ok, false);
});
