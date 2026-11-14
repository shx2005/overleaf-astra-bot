import type { ReviewEvent } from "../extension/reviews.js";

export function pdfBatchInput(
  pages: Array<{ page: number; image: string }>,
  compiledAt: string,
  total: number
) {
  return [
    {
      type: "text" as const,
      text: `PDF snapshot ${compiledAt}. Images in page order ${pages
        .map((p) => p.page)
        .join(
          ","
        )} of ${total}. Read every supplied page visually and retain the paper context. This snapshot supersedes older PDF snapshots. Do not use tools or edit. Brief internal acknowledgement only.`,
    },
    ...pages.map((page) => ({ type: "localImage" as const, path: page.image })),
  ];
}

export function commentInput(context: any): object[] {
  if (!context) return [];
  const { selectedText, ...metadata } = context;
  const items: object[] = [];
  if (
    selectedText &&
    typeof selectedText.text === "string" &&
    selectedText.text
  ) {
    // Keep one explicit text item for the selection; do not repeat it in metadata.
    items.push({
      type: "text" as const,
      text: `USER-SELECTED TEX:\n${JSON.stringify(selectedText)}`,
    });
    if (metadata.anchor) {
      const { text: _text, ...range } = metadata.anchor;
      metadata.anchor = range;
    }
  }
  if (metadata.editableRange) {
    const { policy: _legacyPolicy, ...range } = metadata.editableRange;
    if (
      range.text === selectedText?.text ||
      range.text === metadata.paragraph?.text
    )
      delete range.text;
    metadata.editableRange = range;
  }
  items.push({
    type: "text" as const,
    text: `COMMENT CONTEXT:\n${JSON.stringify(metadata)}`,
  });
  return items;
}

export function commandInput(task: {
  request: string;
  requestedAt: string;
  pdfSnapshotAt?: string;
  reviewEvents: ReviewEvent[];
  feedbackReviewId?: string;
  commentContext?: unknown;
}): object[] {
  const { commentContext, ...data } = task;
  return [
    { type: "text", text: `CURRENT TASK:\n${JSON.stringify(data)}` },
    ...commentInput(commentContext),
  ];
}
