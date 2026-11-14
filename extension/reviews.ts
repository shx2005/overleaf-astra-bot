import { withExtensionContext } from "./extension-context";
export type ReviewEvent = {
  id: string;
  projectId: string;
  proposalId: string;
  status: "accepted" | "rejected" | "rejected_with_feedback";
  filePath: string;
  oldText: string;
  newText: string;
  feedback?: string;
  at: string;
};
export const reviewKey = (projectId: string, id: string) =>
  `overleaf-bot:review:${projectId}:${id}`;

// One key per decision: concurrent tabs cannot overwrite each other's events.
export async function saveReview(event: ReviewEvent) {
  await withExtensionContext(() =>
    chrome.storage.local.set({
      [reviewKey(event.projectId, event.id)]: event,
    })
  );
}
export async function pendingReviews(
  projectId: string
): Promise<ReviewEvent[]> {
  const all = await withExtensionContext(() => chrome.storage.local.get(null));
  return Object.entries(all)
    .filter(([key]) => key.startsWith(reviewKey(projectId, "")))
    .map(([, event]) => event as ReviewEvent)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export async function acknowledgeReviews(projectId: string, ids: string[]) {
  await withExtensionContext(() =>
    chrome.storage.local.remove(ids.map((id) => reviewKey(projectId, id)))
  );
}

// Shared by the native host; reject corrupt or cross-project input before use.
export function validateReviews(
  value: unknown,
  projectId: string
): ReviewEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid review events");
  const seen = new Set<string>();
  return value.map((e: any) => {
    if (
      !e ||
      e.projectId !== projectId ||
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(e.id) ||
      seen.has(e.id) ||
      typeof e.proposalId !== "string" ||
      !e.proposalId ||
      !["accepted", "rejected", "rejected_with_feedback"].includes(e.status) ||
      typeof e.filePath !== "string" ||
      !e.filePath ||
      typeof e.oldText !== "string" ||
      !e.oldText ||
      typeof e.newText !== "string" ||
      typeof e.at !== "string" ||
      !Number.isFinite(Date.parse(e.at)) ||
      (e.feedback !== undefined && typeof e.feedback !== "string") ||
      (e.status === "rejected_with_feedback" && !e.feedback?.trim())
    )
      throw new Error("Invalid review event or project mismatch");
    seen.add(e.id);
    return {
      id: e.id,
      projectId,
      proposalId: e.proposalId,
      status: e.status,
      filePath: e.filePath,
      oldText: e.oldText,
      newText: e.newText,
      feedback: e.feedback,
      at: e.at,
    };
  });
}
export function newReviews(events: ReviewEvent[], deliveredIds: string[] = []) {
  const delivered = new Set(deliveredIds);
  return events.filter((event) => !delivered.has(event.id));
}
