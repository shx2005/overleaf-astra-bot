import { reviewComment } from "./review-comment";
import { presentContextUsage } from "./context-usage";
import {
  requireExtensionContext,
  extensionError,
  ExtensionReloadRequired,
} from "./extension-context";
import {
  saveReview,
  pendingReviews,
  acknowledgeReviews,
  type ReviewEvent,
} from "./reviews";
import {
  BOT_TRIGGER,
  BOT_REQUEST,
  BOT_RESPONSE,
  type BotTrigger,
} from "./protocol";
let busy = false;
const seen = new Set<string>();
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }
>();
window.addEventListener(BOT_RESPONSE, (event: Event) => {
  const { id, result, error } = (event as CustomEvent).detail ?? {};
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  error ? p.reject(new Error(error)) : p.resolve(result);
});
function browserCall(
  jobId: string,
  method: string,
  args: object = {}
): Promise<any> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("Browser operation timed out"));
      },
      method === "compile_pdf"
        ? 330000
        : method === "comment_context"
        ? 60000
        : 20000
    );
    pending.set(id, { resolve, reject, timer });
    window.dispatchEvent(
      new CustomEvent(BOT_REQUEST, { detail: { id, jobId, method, args } })
    );
  });
}
function resultPanel() {
  // Keep earlier answers and pending edits visible during feedback turns.
  const container =
    document.getElementById("ageaf-bot-result") ??
    document.createElement("section");
  container.id = "ageaf-bot-result";
  const root = document.createElement("section");
  container.append(root);
  container.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483647;width:440px;max-width:90vw;max-height:70vh;overflow:auto;background:#fff;color:#18242a;border:1px solid #becbc4;border-radius:12px;padding:18px;box-shadow:0 8px 36px #0003;font:14px/1.5 system-ui";
  const title = document.createElement("strong");
  title.textContent = "@bot · GPT-6 Astra";
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const usage = document.createElement("small");
  usage.textContent = "上下文：待统计";
  usage.setAttribute("role", "status");
  usage.setAttribute("aria-label", "上下文用量");
  usage.style.cssText =
    "font:11px/1.45 system-ui;text-align:right;white-space:pre-line;color:#52635c;max-width:250px";
  header.append(title, usage);
  root.append(header);
  const status = document.createElement("p");
  status.textContent = "正在连接…";
  status.setAttribute("role", "status");
  root.append(status);
  const output = document.createElement("div");
  output.style.whiteSpace = "pre-wrap";
  root.append(output);
  const changes = document.createElement("div");
  root.append(changes);
  const close = document.createElement("button");
  close.textContent = "关闭结果";
  close.style.marginTop = "12px";
  close.onclick = () => {
    if (!busy) {
      root.remove();
      if (!container.childElementCount) container.remove();
    }
  };
  root.append(close);
  document.body.append(container);
  return { root, status, output, changes, usage };
}
function showExtensionFailure(
  ui: ReturnType<typeof resultPanel>,
  error: unknown,
  prefix: string
) {
  const failure = extensionError(error);
  ui.status.textContent = prefix + failure.message;
  if (
    failure instanceof ExtensionReloadRequired &&
    !ui.root.querySelector("[data-bot-refresh]")
  ) {
    const reload = document.createElement("button");
    reload.textContent = "已保存，刷新页面";
    reload.setAttribute("data-bot-refresh", "true");
    reload.onclick = (event) => {
      if (event.isTrusted) location.reload();
    };
    ui.root.append(reload);
  }
}
window.addEventListener(BOT_TRIGGER, async (event: Event) => {
  const trigger = (event as CustomEvent<BotTrigger>).detail;
  if (!trigger?.id || seen.has(trigger.id)) return;
  seen.add(trigger.id);
  if (seen.size > 200) seen.delete(seen.values().next().value!);
  if (busy) {
    void browserCall(trigger.scopeId ?? trigger.id, "reply", {
      text: "上一条指令仍在处理中，请完成后再发送 @bot。",
    });
    return;
  }
  const scopeId = trigger.scopeId ?? trigger.id;
  busy = true;
  const ui = resultPanel();
  let finished = false,
    finalText = "",
    proposalCount = 0;
  let reviews: ReviewEvent[];
  let port: chrome.runtime.Port;
  try {
    reviews = await pendingReviews(trigger.projectId);
    requireExtensionContext();
    port = chrome.runtime.connect({ name: "ageaf:bot" });
  } catch (error) {
    showExtensionFailure(ui, error, "任务未启动：");
    busy = false;
    return;
  }
  const cancel = document.createElement("button");
  cancel.textContent = "停止";
  ui.root.append(cancel);
  cancel.onclick = (e) => {
    if (e.isTrusted) port.disconnect();
  };
  const finish = () => {
    finished = true;
    busy = false;
    cancel.remove();
  };
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (!finished) {
      ui.status.textContent = error ?? "任务已停止；没有自动应用论文修改。";
      finish();
    }
  });
  port.onMessage.addListener(async (message) => {
    if (message.type === "context_usage") {
      const display = presentContextUsage(message.usage, message.cached);
      ui.usage.textContent = display.label;
      ui.usage.title = display.detail;
      ui.usage.style.color =
        display.level === "full"
          ? "#b42318"
          : display.level === "near"
          ? "#9a6700"
          : "#52635c";
    }
    if (message.type === "status") ui.status.textContent = message.text;
    if (message.type === "delta") {
      finalText += message.text;
      ui.output.textContent = finalText;
    }
    if (message.type === "browser_request") {
      try {
        let result: any;
        if (message.method === "propose_edit") {
          let args = message.args;
          if (
            typeof args.filePath !== "string" ||
            typeof args.oldText !== "string" ||
            !args.oldText ||
            typeof args.newText !== "string"
          )
            throw new Error("Invalid edit");
          args = await browserCall(scopeId, "validate_edit", args);
          proposalCount++;
          const proposalId = `${trigger.id}:${proposalCount}`;
          let deciding = false;
          let applied = false;
          const record = async (
            status: ReviewEvent["status"],
            feedback?: string
          ) => {
            const event: ReviewEvent = {
              id: crypto.randomUUID(),
              projectId: trigger.projectId,
              proposalId,
              status,
              filePath: args.filePath,
              oldText: args.oldText,
              newText: args.newText,
              feedback,
              at: new Date().toISOString(),
            };
            await saveReview(event);
            return event;
          };
          const card = document.createElement("details");
          card.open = true;
          card.style.cssText =
            "border-top:1px solid #ddd;margin-top:12px;padding-top:12px";
          const summary = document.createElement("summary");
          summary.textContent = `${args.filePath}:${args.line} · 字符 ${
            args.from
          }–${args.to} — ${args.reason ?? "修改建议"}`;
          card.append(summary);
          for (const [label, text] of [
            ["修改前", args.oldText],
            ["修改后", args.newText],
          ]) {
            const h = document.createElement("strong");
            h.textContent = label;
            const pre = document.createElement("pre");
            pre.style.cssText =
              "white-space:pre-wrap;max-height:180px;overflow:auto";
            pre.textContent = text;
            card.append(h, pre);
          }
          const publishReview = async (event: ReviewEvent) => {
            const note = document.createElement("p");
            const retry = document.createElement("button");
            retry.textContent = "重试同步评论";
            retry.style.display = "none";
            card.append(note, retry);
            const send = async (isRetry: boolean) => {
              retry.disabled = true;
              note.textContent = "拒绝已记录，正在同步原评论／聊天…";
              try {
                await browserCall(scopeId, "reply", {
                  text: reviewComment(event),
                  reviewId: event.id,
                  retry: isRetry,
                });
                note.textContent = "拒绝决定已同步原评论／聊天。";
                retry.remove();
              } catch (error) {
                note.textContent =
                  "拒绝已记录，评论同步未确认：" +
                  String((error as Error).message);
                retry.style.display = "inline-block";
                retry.disabled = false;
              }
            };
            retry.onclick = (e) => {
              if (e.isTrusted && !retry.disabled) void send(true);
            };
            await send(false);
          };
          const accept = document.createElement("button");
          accept.textContent = "接受修改";
          const reject = document.createElement("button");
          reject.textContent = "拒绝";
          accept.onclick = async (e) => {
            if (!e.isTrusted || deciding) return;
            deciding = true;
            accept.disabled =
              reject.disabled =
              revise.disabled =
              submit.disabled =
                true;
            try {
              if (!applied) {
                requireExtensionContext();
                await browserCall(scopeId, "apply_edit", args);
                applied = true;
              }
              await record("accepted");
              accept.textContent = "已应用 · 已记录";
              reject.remove();
              revise.remove();
              feedback.remove();
              submit.remove();
            } catch (err) {
              deciding = false;
              accept.disabled = false;
              reject.disabled = revise.disabled = submit.disabled = applied;
              accept.textContent = applied
                ? "已应用，重试保存记录"
                : "接受修改";
              showExtensionFailure(
                ui,
                err,
                applied ? "正文已应用，但本次审阅记录未保存：" : "修改未应用："
              );
            }
          };
          reject.onclick = async (e) => {
            if (!e.isTrusted || deciding || applied) return;
            deciding = true;
            try {
              const decision = await record("rejected");
              accept.remove();
              reject.disabled = true;
              reject.textContent = "已拒绝 · 已记录";
              revise.remove();
              feedback.remove();
              submit.remove();
              await publishReview(decision);
            } catch (error) {
              deciding = false;
              showExtensionFailure(ui, error, "本次审阅决定未保存：");
            }
          };
          const revise = document.createElement("button");
          revise.textContent = "拒绝并继续修改";
          const feedback = document.createElement("textarea");
          feedback.placeholder = "告诉 GPT 下一步应该怎么改…";
          feedback.setAttribute("aria-label", "修改反馈");
          feedback.style.cssText =
            "display:none;width:100%;min-height:70px;margin-top:8px";
          const submit = document.createElement("button");
          submit.textContent = "发送修改指令";
          submit.style.display = "none";
          revise.onclick = (e) => {
            if (e.isTrusted && !deciding && !applied) {
              feedback.style.display = "block";
              submit.style.display = "inline-block";
              feedback.focus();
            }
          };
          submit.onclick = async (e) => {
            if (
              !e.isTrusted ||
              deciding ||
              applied ||
              busy ||
              !feedback.value.trim()
            )
              return;
            deciding = true;
            const instruction = feedback.value.trim();
            let decision: ReviewEvent;
            busy = true;
            try {
              decision = await record("rejected_with_feedback", instruction);
            } catch (error) {
              busy = false;
              deciding = false;
              showExtensionFailure(ui, error, "本次审阅决定未保存：");
              return;
            }
            accept.remove();
            reject.remove();
            revise.remove();
            submit.disabled = true;
            submit.textContent = "已拒绝并继续";
            feedback.disabled = true;
            await publishReview(decision);
            busy = false;
            const prompt = `上一处修改建议已被我拒绝。文件：${args.filePath}\n原文：${args.oldText}\n被拒绝的建议：${args.newText}\n我的下一步指令：${instruction}\n继续使用本项目的上下文，重新读取相关源文件，生成新的待确认建议。`;
            window.dispatchEvent(
              new CustomEvent(BOT_TRIGGER, {
                detail: {
                  ...trigger,
                  id: crypto.randomUUID(),
                  scopeId,
                  prompt,
                },
              })
            );
          };
          card.append(accept, reject, revise, feedback, submit);
          ui.changes.append(card);
          result = {
            status: "pending_user_approval",
            proposalId: proposalCount,
          };
        } else
          result = await browserCall(scopeId, message.method, message.args);
        port.postMessage({ type: "browser_response", id: message.id, result });
      } catch (error) {
        port.postMessage({
          type: "browser_response",
          id: message.id,
          error: String((error as Error).message),
        });
      }
    }
    if (message.type === "done") {
      finish();
      if (message.error) {
        ui.status.textContent = "运行失败：" + message.error;
        port.disconnect();
        return;
      }
      try {
        const sentIds = new Set(reviews.map((event) => event.id));
        const ack = (message.ackReviewEventIds ?? []).filter((id: string) =>
          sentIds.has(id)
        );
        await acknowledgeReviews(trigger.projectId, ack);
      } catch (error) {
        // Keep records on storage failure; host deduplicates them on the next call.
        console.warn("Could not clear delivered review records", error);
      }
      const suffix = proposalCount
        ? `\n\n已生成 ${proposalCount} 处修改建议，尚未写入论文。请在本机的 @bot 结果框中逐条接受或拒绝。`
        : "";
      try {
        await browserCall(scopeId, "reply", { text: finalText + suffix });
        ui.status.textContent = "已回复原评论／聊天；后台已停止。";
      } catch (error) {
        ui.status.textContent =
          "模型已完成，但回复发送失败。结果保留在此：" +
          String((error as Error).message);
      } finally {
        port.disconnect();
      }
    }
  });
  port.postMessage({
    type: "start",
    trigger: { ...trigger, reviewEvents: reviews },
  });
});
