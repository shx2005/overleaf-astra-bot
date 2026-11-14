export type CommentAnchor = {
  threadId: string;
  docId: string;
  from: number;
  text: string;
  draft: boolean;
};

// Overleaf exposes the actual comment operation on ReviewPanelEntry props.
// Read only the bounded ancestor chain, on a user submission (never at idle).
export function anchorFromElement(
  element: Element | null
): CommentAnchor | undefined {
  let node: any = element;
  for (let depth = 0; node && depth < 40; depth++) {
    const key = Object.keys(node).find((key) =>
      key.startsWith("__reactFiber$")
    );
    let fiber = key ? node[key] : null;
    for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      const op = p?.op;
      if (
        typeof p?.docId === "string" &&
        typeof op?.t === "string" &&
        typeof op.c === "string" &&
        Number.isSafeInteger(op.p) &&
        op.p >= 0
      ) {
        return {
          threadId: op.t,
          docId: p.docId,
          from: op.p,
          text: op.c,
          draft: p.selectLineOnFocus === false,
        };
      }
    }
    node = node.parentElement ?? node.getRootNode?.()?.host;
  }
}
export function findThreadAnchor(threadId: string): CommentAnchor | undefined {
  for (const entry of Array.from(
    document.querySelectorAll(".review-panel-entry")
  )) {
    const anchor = anchorFromElement(entry);
    if (anchor?.threadId === threadId && !anchor.draft) return anchor;
  }
}
export function documentBasename(docId: string): string | undefined {
  if (!/^[a-f0-9]{24}$/i.test(docId)) return;
  const element = document.querySelector(
    `[data-file-id="${docId}"], [data-tab-id="${docId}"]`
  );
  if (!element) return;
  const key = Object.keys(element).find((key) =>
    key.startsWith("__reactFiber$")
  );
  let fiber = key ? (element as any)[key] : null;
  for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
    const p = fiber.memoizedProps;
    if (
      (p?.id === docId || p?.entity?._id === docId) &&
      typeof (p.name ?? p.entity?.name) === "string"
    )
      return p.name ?? p.entity.name;
  }
}
export function sourceContext(
  source: string,
  anchor: CommentAnchor,
  filePath: string
) {
  // Stale offsets must never be silently replaced with an unrelated selection.
  if (
    !anchor.text ||
    source.slice(anchor.from, anchor.from + anchor.text.length) !== anchor.text
  )
    return {
      filePath,
      docId: anchor.docId,
      anchorAvailable: false,
      note: "Comment anchor is detached or no longer matches the live source.",
    };
  const before = source.slice(0, anchor.from);
  const sections: { level: number; title: string }[] = [];
  const pattern =
    /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  // Preserve offsets while removing unescaped TeX comments.
  const clean = source.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm, (s) =>
    " ".repeat(s.length)
  );
  for (const match of clean.matchAll(pattern)) {
    if (match.index! > anchor.from) break;
    const level = [
      "part",
      "chapter",
      "section",
      "subsection",
      "subsubsection",
      "paragraph",
    ].indexOf(match[1]);
    while (sections.length && sections[sections.length - 1].level >= level)
      sections.pop();
    sections.push({ level, title: match[2] });
  }
  // Include surrounding paragraphs, with explicit bounds for unusually long text.
  const end = anchor.from + anchor.text.length;
  const previous = before.lastIndexOf(
    "\n\n",
    Math.max(0, before.lastIndexOf("\n\n") - 1)
  );
  const next = source.indexOf("\n\n", end);
  const following = next < 0 ? source.length : source.indexOf("\n\n", next + 2);
  const start = Math.max(
    0,
    previous < 0 ? 0 : previous + 2,
    anchor.from - 4000
  );
  const stop = Math.min(
    source.length,
    following < 0 ? source.length : following,
    end + 4000
  );
  return {
    filePath,
    docId: anchor.docId,
    anchorAvailable: true,
    anchor: {
      text: anchor.text,
      from: anchor.from,
      to: end,
      line: before.split("\n").length,
    },
    section: sections.map((s) => s.title),
    before: source.slice(start, anchor.from),
    after: source.slice(end, stop),
    surroundingTextTruncated:
      start > (previous < 0 ? 0 : previous + 2) ||
      stop < (following < 0 ? source.length : following),
  };
}
