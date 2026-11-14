export type EditScope = { filePath: string; from: number; text: string };
export type ExactEdit = {
  filePath: string;
  oldText: string;
  newText: string;
  from?: number;
  reason?: string;
};

// CodeMirror uses UTF-16 character offsets, independent of TeX source line wraps.
export function locateEdit(source: string, edit: ExactEdit, scope?: EditScope) {
  if (!edit.oldText || typeof edit.newText !== "string")
    throw new Error("Invalid edit");
  const filePath = edit.filePath.replace(/^\/+/, "");
  if (
    scope &&
    (filePath !== scope.filePath ||
      source.slice(scope.from, scope.from + scope.text.length) !== scope.text)
  )
    throw new Error(
      "评论对应的段落或文件已变化，请重新调用 @bot；不会改到其他位置。"
    );
  const start = scope?.from ?? 0;
  const end = scope ? start + scope.text.length : source.length;
  let from = edit.from;
  if (from === undefined) {
    const region = source.slice(start, end);
    const first = region.indexOf(edit.oldText);
    if (first < 0)
      throw new Error(
        "修改超出目标段落或原文不匹配。可以调整该段内的句式，但不要包含相邻段落。"
      );
    if (region.indexOf(edit.oldText, first + 1) >= 0)
      throw new Error(
        "目标原文在可修改范围内重复，请用 from 指定准确的字符起点。"
      );
    from = start + first;
  }
  if (
    !Number.isSafeInteger(from) ||
    from < start ||
    from + edit.oldText.length > end ||
    source.slice(from, from + edit.oldText.length) !== edit.oldText
  )
    throw new Error("修改范围已失效或超出目标段落；请重新读取并生成建议。");
  return {
    ...edit,
    filePath,
    from,
    to: from + edit.oldText.length,
    line: source.slice(0, from).split("\n").length,
  };
}
