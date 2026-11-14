import test from "node:test";
import assert from "node:assert/strict";
import { locateEdit } from "../extension/edit-scope.js";
const filePath = "main.tex";
const source = String.raw`First sentence stays. Our method improves accuracy~\cite{smith2026}. Last sentence stays.`;
const sentence = String.raw`Our method improves accuracy~\cite{smith2026}.`;
const scope = { filePath, from: source.indexOf(sentence), text: sentence };
const edit = {
  filePath,
  oldText: sentence,
  newText: String.raw`Our method increases accuracy~\cite{smith2026}.`,
};
test("one sentence in a single-line TeX paragraph preserves all neighboring bytes", () => {
  const patch = locateEdit(source, edit, scope);
  const result =
    source.slice(0, patch.from) + patch.newText + source.slice(patch.to);
  assert.equal(patch.line, 1);
  assert.equal(result, source.replace(sentence, edit.newText));
  assert.ok(result.endsWith(" Last sentence stays."));
  assert.ok(result.startsWith("First sentence stays. "));
  assert.throws(
    () => locateEdit(source, { ...edit, oldText: source }, scope),
    /超出/
  );
});
test("selection disambiguates identical sentences elsewhere in the same line", () => {
  const text = "Same sentence. Same sentence. Tail.";
  const patch = locateEdit(
    text,
    { filePath, oldText: "Same sentence.", newText: "Changed." },
    { filePath, from: 15, text: "Same sentence." }
  );
  assert.equal(patch.from, 15);
  assert.equal(
    text.slice(0, patch.from) + patch.newText + text.slice(patch.to),
    "Same sentence. Changed. Tail."
  );
});
test("explicit offsets disambiguate within a paragraph but cannot escape its range", () => {
  const text = "Same. Same. Outside.";
  const scope = { filePath, from: 0, text: "Same. Same." };
  const edit = { filePath, oldText: "Same.", newText: "New." };
  assert.throws(() => locateEdit(text, edit, scope), /重复/);
  assert.equal(locateEdit(text, { ...edit, from: 6 }, scope).from, 6);
  assert.throws(
    () => locateEdit(text, { ...edit, oldText: "Outside.", from: 12 }, scope),
    /超出/
  );
});
test("stale offsets, changed anchors and other files cannot silently target another occurrence", () => {
  assert.throws(
    () => locateEdit("prefix " + source, { ...edit, from: scope.from }, scope),
    /变化/
  );
  assert.throws(
    () => locateEdit(source, { ...edit, filePath: "other.tex" }, scope),
    /文件/
  );
  assert.throws(() => locateEdit(source, { ...edit, from: 0 }, scope), /超出/);
});
test("Unicode offsets follow CodeMirror UTF-16 and never depend on line breaks", () => {
  const text = "😀第一句。只改这句。第三句。";
  const from = text.indexOf("只改这句。");
  const patch = locateEdit(
    text,
    { filePath, oldText: "只改这句。", newText: "已改这一句。" },
    { filePath, from, text: "只改这句。" }
  );
  assert.equal(patch.from, from);
  assert.equal(
    text.slice(0, patch.from) + patch.newText + text.slice(patch.to),
    "😀第一句。已改这一句。第三句。"
  );
});
