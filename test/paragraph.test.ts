import test from "node:test";
import assert from "node:assert/strict";
import { texParagraph } from "../extension/paragraph.js";
import { sourceContext } from "../extension/comment-context.js";
import { locateEdit } from "../extension/edit-scope.js";
function around(source: string, selected: string) {
  const from = source.indexOf(selected);
  return texParagraph(source, from, from + selected.length);
}
test("selecting a word authorizes restructuring its sentence inside its containing paragraph", () => {
  const paragraph = "This method is good. It is supported by evidence.";
  const source = "Earlier paragraph.\n\n" + paragraph + "\n\nLater paragraph.";
  const range = around(source, "good")!;
  assert.equal(range.text, paragraph);
  const scope = {
    filePath: "sec/intro.tex",
    from: range.from,
    text: range.text,
  };
  const edit = locateEdit(
    source,
    {
      filePath: scope.filePath,
      oldText: "This method is good.",
      newText: "Evidence supports the effectiveness of this method.",
    },
    scope
  );
  assert.equal(
    source.slice(0, edit.from) + edit.newText + source.slice(edit.to),
    "Earlier paragraph.\n\nEvidence supports the effectiveness of this method. It is supported by evidence.\n\nLater paragraph."
  );
  assert.throws(
    () =>
      locateEdit(
        source,
        {
          filePath: scope.filePath,
          oldText: "Later paragraph.",
          newText: "Changed.",
        },
        scope
      ),
    /超出目标段落/
  );
});
test("soft line wraps remain one paragraph; whitespace-only blank lines delimit paragraphs", () => {
  const text =
    "Earlier.\r\n \t\r\nOne sentence\r\ncontinues here. More text.\r\n\r\nLater.";
  assert.equal(
    around(text, "continues")?.text,
    "One sentence\r\ncontinues here. More text."
  );
});
test("section and environment commands do not leak into adjacent prose even on one line", () => {
  const text = String.raw`\section{Intro {nested}}Paragraph with good wording.\begin{abstract}Another text.\end{abstract}\section{Next}Later.`;
  assert.equal(around(text, "good")?.text, "Paragraph with good wording.");
  assert.equal(around(text, "Another")?.text, "Another text.");
  assert.equal(
    around(text, "nested")?.text,
    String.raw`\section{Intro {nested}}`
  );
});
test("explicit par and list items bound edits, while TeX comments do not create fake boundaries", () => {
  const text =
    "Before.\\par Target words\n% \\section{not a real section}\ncontinue here.\\par After.";
  assert.equal(
    around(text, "Target")?.text,
    "Target words\n% \\section{not a real section}\ncontinue here."
  );
  assert.equal(
    around(
      String.raw`\begin{itemize}\item First words.\item Second words.\end{itemize}`,
      "First"
    )?.text,
    "First words."
  );
});
test("multi-paragraph selections do not silently authorize multiple paragraphs", () => {
  const text = "First paragraph.\n\nSecond paragraph.";
  assert.equal(texParagraph(text, 0, text.length), undefined);
  assert.equal(
    around("% comment-only text\nReal paragraph.", "comment-only"),
    undefined
  );
});
test("context keeps the selected word distinct from editable paragraph and outside context", () => {
  const source =
    "Previous.\n\nThis wording is good. Change the sentence structure if needed.\n\nNext.";
  const from = source.indexOf("good");
  const context = sourceContext(
    source,
    { docId: "doc", threadId: "thread", from, text: "good", draft: false },
    "main.tex"
  );
  assert.equal(context.anchor?.text, "good");
  assert.equal(
    context.paragraph?.text,
    "This wording is good. Change the sentence structure if needed."
  );
  assert.ok(context.before?.includes("Previous."));
  assert.ok(!context.before?.includes("This wording"));
  assert.ok(context.after?.includes("Next."));
});
