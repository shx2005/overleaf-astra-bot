// Source paragraphs are separated by blank lines or explicit TeX structure,
// not by line wrapping. Offsets always refer to the original UTF-16 source.
export function texParagraph(source: string, from: number, to: number) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > source.length
  )
    return;
  const escaped = (at: number) => {
    let count = 0;
    for (let i = at - 1; i >= 0 && source[i] === "\\"; i--) count++;
    return count % 2 === 1;
  };
  const chars = source.split("");
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "%" && !escaped(i)) {
      while (i < source.length && source[i] !== "\n") chars[i++] = " ";
    }
  }
  const clean = chars.join("");
  if (!clean.slice(from, to).trim()) return;
  const barriers: { from: number; to: number; editable: boolean }[] = [];
  for (const m of source.matchAll(/(?:^|\n)[ \t]*\r?\n/g))
    barriers.push({
      from: m.index!,
      to: m.index! + m[0].length,
      editable: false,
    });
  const groupEnd = (start: number, open: string, close: string) => {
    if (clean[start] !== open) return start;
    let depth = 0;
    for (let i = start; i < clean.length; i++) {
      if (escaped(i)) continue;
      if (clean[i] === open) depth++;
      if (clean[i] === close && --depth === 0) return i + 1;
    }
    return start;
  };
  for (const m of clean.matchAll(
    /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|begin|end|item|par)\b\*?/g
  )) {
    if (escaped(m.index!)) continue;
    let end = m.index! + m[0].length;
    if (m[1] !== "par") {
      while (/[ \t]/.test(clean[end] ?? "") && end < clean.length) end++;
      if (clean[end] === "[") end = groupEnd(end, "[", "]");
      while (/[ \t]/.test(clean[end] ?? "") && end < clean.length) end++;
      if (m[1] !== "item") end = groupEnd(end, "{", "}");
    }
    barriers.push({ from: m.index!, to: end, editable: m[1] !== "par" });
  }
  barriers.sort((a, b) => a.from - b.from);
  let start = 0;
  const region = (left: number, right: number) => {
    while (left < right && /\s/.test(source[left])) left++;
    while (right > left && /\s/.test(source[right - 1])) right--;
    // Ignore whitespace at the edges of a user's selection.
    let a = from,
      b = to;
    while (a < b && /\s/.test(source[a])) a++;
    while (b > a && /\s/.test(source[b - 1])) b--;
    if (a >= left && b <= right && a < b)
      return { from: left, to: right, text: source.slice(left, right) };
  };
  for (const barrier of barriers) {
    const found = region(start, barrier.from);
    if (found) return found;
    if (barrier.editable) {
      const own = region(barrier.from, barrier.to);
      if (own) return own;
    }
    start = Math.max(start, barrier.to);
  }
  return region(start, source.length);
}
