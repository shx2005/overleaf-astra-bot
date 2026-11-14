import type { ReviewEvent } from "./reviews";
export function reviewComment(event: ReviewEvent) {
  const excerpt = (text: string) =>
    text.length > 3500
      ? text.slice(0, 3500) + "\n（节选，完整内容见修改建议）"
      : text;
  return `审阅决定：${
    event.status === "rejected_with_feedback" ? "拒绝并继续修改" : "拒绝"
  }\n文件：${event.filePath}\n${
    event.feedback ? `我的下一步要求：${event.feedback}` : "未填写拒绝原因。"
  }\n\n原文：\n${excerpt(event.oldText)}\n\n未采用的建议：\n${excerpt(
    event.newText
  )}\n\n本次拒绝未应用这处建议。\n审阅编号：${event.id}`;
}
