import type { ContextUsage } from "../extension/context-usage.js";
import { usageWithConfig, usageFromNotification } from "./usage.js";
import { Console } from "node:console";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { CodexAppServer } from "./codex.js";
import { decodeNativeMessages, encodeNativeMessage } from "./framing.js";
import {
  projectDirectory,
  lockProject,
  readState,
  saveState,
  projectWorkspace,
  projectCodexHome,
  legacyProjectDirectory,
  type ProjectState,
} from "./session.js";
import { validateReviews, newReviews } from "../extension/reviews.js";
import { pdfBatchInput, commandInput } from "./context.js";
import { EDITOR_INSTRUCTIONS } from "./prompts.js";
import { downloadPdf, preparePdf } from "./pdf.js";
import { createSerialJobQueue } from "./job-queue.js";

globalThis.console = new Console({
  stdout: process.stderr,
  stderr: process.stderr,
});
let currentJobId: string | null = null;
const send = (message: Record<string, unknown>) =>
  process.stdout.write(
    encodeNativeMessage(
      currentJobId && message.jobId === undefined
        ? { ...message, jobId: currentJobId }
        : message
    )
  );
let carry: Buffer = Buffer.alloc(0),
  closed = false;
let codex: CodexAppServer | null = null;
let contextUsage: ContextUsage = {};
let unlock: (() => void) | null = null;
let activeProjectId: string | null = null;
let activeProjectDir: string | null = null;
let activeThreadId: string | null = null;
let activeState: ProjectState | null = null;
let idleCleanupTimer: NodeJS.Timeout | null = null;
const pending = new Map<
  string,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
const token = randomBytes(32).toString("hex");
const allowed = new Set([
  "list_files",
  "read_selection",
  "read_file",
  "read_comments",
  "propose_edit",
]);
function browserCall(method: string, args: object): Promise<any> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("Browser tool timed out"));
      },
      method === "compile_pdf"
        ? 330000
        : method === "comment_context"
        ? 65000
        : 25000
    );
    pending.set(id, { resolve, reject, timer });
    send({ type: "browser_request", id, method, args });
  });
}
const broker = createServer(async (req, res) => {
  if (
    req.method !== "POST" ||
    req.url !== "/tool" ||
    req.headers.authorization !== `Bearer ${token}`
  ) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2_000_000) throw new Error("Request too large");
    }
    const { method, args } = JSON.parse(body);
    if (!allowed.has(method)) throw new Error("Unknown tool");
    const result = await browserCall(method, args ?? {});
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ result }));
  } catch (error) {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: String((error as Error).message) }));
  }
});
async function cleanupJob() {
  if (idleCleanupTimer) {
    clearTimeout(idleCleanupTimer);
    idleCleanupTimer = null;
  }
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("Task ended"));
  }
  pending.clear();
  await codex?.stop();
  codex = null;
  unlock?.();
  unlock = null;
  activeProjectId = null;
  activeProjectDir = null;
  activeThreadId = null;
  activeState = null;
  broker.closeAllConnections();
  if (broker.listening) await new Promise<void>((r) => broker.close(() => r()));
}
async function cleanup() {
  if (closed) return;
  closed = true;
  clearTimeout(deadline);
  await cleanupJob();
}
const deadline = setTimeout(() => {
  void cleanup().finally(() => {
    send({ type: "done", error: "Task exceeded 30 minutes" });
    process.exit(0);
  });
}, 30 * 60 * 1000);
async function runTurn(threadId: string, input: object[]): Promise<string> {
  let resolveTurn: (v: any) => void = () => {};
  const completion = new Promise<any>((resolve) => {
    resolveTurn = resolve;
  });
  const messages = new Map<string, string>();
  const unsubscribe = codex!.subscribe((msg) => {
    const p = msg.params as any;
    if (msg.id != null && msg.method) {
      void codex?.respond(msg.id, { decision: "decline" });
      return;
    }
    if (p?.threadId && p.threadId !== threadId) return;
    const usage = usageFromNotification(
      contextUsage,
      msg.method ?? "",
      p,
      threadId
    );
    if (usage) {
      contextUsage = usage;
      send({ type: "context_usage", usage: contextUsage, cached: false });
    }
    if (msg.method === "item/started" && p?.item?.type === "mcpToolCall")
      send({ type: "status", text: "正在调用 " + p.item.tool + "…" });
    if (msg.method === "item/completed" && p?.item?.type === "agentMessage")
      messages.set(p.item.id, String(p.item.text ?? ""));
    if (msg.method === "turn/completed") resolveTurn(p.turn);
    if (msg.method === "error" && !p?.willRetry)
      resolveTurn({ status: "failed", error: p?.error });
  });
  try {
    const response = await codex!.request(
      "turn/start",
      {
        threadId,
        input,
        model: "gpt-6-astra",
        effort: "high",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
      },
      { timeoutMs: 60000 }
    );
    if (response.error)
      throw new Error(String((response.error as any).message));
    const result = await completion;
    if (result?.status !== "completed")
      throw new Error(
        String(result?.error?.message ?? "Codex task did not complete")
      );
    return Array.from(messages.values()).pop() ?? "任务完成。";
  } finally {
    unsubscribe();
  }
}
async function start(trigger: any) {
  try {
    if (
      typeof trigger?.prompt !== "string" ||
      !trigger.prompt.trim() ||
      trigger.prompt.length > 200000
    )
      throw new Error("Invalid command");
    const reuse =
      activeProjectId === trigger.projectId &&
      !!codex &&
      broker.listening &&
      !!activeState &&
      !!activeThreadId;
    const projectDir = reuse
      ? activeProjectDir!
      : projectDirectory(trigger.projectId);
    const existingState = reuse ? activeState : readState(projectDir);
    const codexHome = projectCodexHome(projectDir);
    const resetThread = !!existingState && existingState.codexHome !== codexHome;
    const legacyCwd = legacyProjectDirectory(trigger.projectId);
    const requestedCwd =
      existingState?.codexCwd ??
      (fs.existsSync(legacyCwd) && projectDir !== legacyCwd
        ? legacyCwd
        : projectWorkspace(projectDir));
    const cwd = fs.existsSync(requestedCwd)
      ? fs.realpathSync(requestedCwd)
      : projectWorkspace(projectDir);
    if (!reuse) unlock = lockProject(projectDir);
    let state = existingState;
    contextUsage = { ...state?.contextUsage, compacting: false };
    send({ type: "context_usage", usage: contextUsage, cached: true });
    const reviews = validateReviews(trigger.reviewEvents, trigger.projectId);
    const undelivered = newReviews(reviews, state?.reviewEventIds);
    const commentContext = trigger.threadId
      ? await browserCall("comment_context", {
          reviewHistory: state?.reviewHistory ?? [],
        })
      : undefined;
    const refresh = /^(?:更新|刷新|重新读取)\s*PDF\b/i.test(
      trigger.prompt.trim()
    );
    let pdfData: Awaited<ReturnType<typeof downloadPdf>> | null = null;
    let pages: Awaited<ReturnType<typeof preparePdf>> = [];
    if (
      resetThread ||
      !state?.pdf ||
      state.pdf.completedPages < state.pdf.pages ||
      refresh
    ) {
      if (state?.pdf && !refresh) {
        const target = path.join(projectDir, "pdf", state.pdf.sha256);
        pdfData = {
          target,
          pdfPath: path.join(target, "paper.pdf"),
          sha256: state.pdf.sha256,
          compiledAt: state.pdf.compiledAt,
        };
      } else {
        send({
          type: "status",
          text: "首次初始化／更新：正在编译并读取整篇论文 PDF…",
        });
        pdfData = await downloadPdf(projectDir, browserCall);
      }
      send({ type: "status", text: "正在渲染 PDF 所有页面（仅图片）…" });
      pages = await preparePdf(pdfData.pdfPath, pdfData.target);
    }
    let threadId: string;
    if (reuse) {
      threadId = activeThreadId!;
    } else {
      send({
        type: "status",
        text: state
          ? "正在恢复本项目的 bot 会话…"
          : "正在创建本项目的 bot 会话…",
      });
      await new Promise<void>((resolve, reject) => {
        broker.once("error", reject);
        broker.listen(0, "127.0.0.1", resolve);
      });
      const address = broker.address();
      if (!address || typeof address === "string")
        throw new Error("MCP bridge failed");
      const mcpPath = fileURLToPath(new URL("./mcp.ts", import.meta.url));
      const configOverrides = [
        "mcp_servers={}",
        `mcp_servers.ageaf_overleaf.command=${JSON.stringify(
          process.execPath
        )}`,
        `mcp_servers.ageaf_overleaf.args=${JSON.stringify([
          "--import",
          fileURLToPath(
            new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url)
          ),
          mcpPath,
        ])}`,
        'mcp_servers.ageaf_overleaf.env_vars=["AGEAF_BOT_ENDPOINT","AGEAF_BOT_TOKEN"]',
        "mcp_servers.ageaf_overleaf.tool_timeout_sec=35",
        'mcp_servers.ageaf_overleaf.default_tools_approval_mode="approve"',
        "agents.enabled=false",
      ];
      codex = new CodexAppServer({
        cwd,
        configOverrides,
        cliPath: process.env.AGEAF_CODEX_CLI_PATH,
        envVars: `AGEAF_BOT_ENDPOINT=http://127.0.0.1:${address.port}/tool\nAGEAF_BOT_TOKEN=${token}\nCODEX_HOME=${codexHome}`,
      });
      await codex.ensureInitialized();
      try {
        const config = await codex.request(
          "config/read",
          { includeLayers: false, cwd },
          { timeoutMs: 10000 }
        );
        if (!config.error && (config.result as any)?.config) {
          contextUsage = usageWithConfig(
            contextUsage,
            (config.result as any).config
          );
          send({ type: "context_usage", usage: contextUsage, cached: true });
        }
      } catch {
        /* Usage display must not prevent a paper task from running. */
      }
      const params = {
        model: "gpt-6-astra",
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        developerInstructions: EDITOR_INSTRUCTIONS,
      };
      const response = state && !resetThread
        ? await codex.request("thread/resume", {
            ...params,
            threadId: state.threadId,
            excludeTurns: true,
          })
        : await codex.request("thread/start", { ...params, ephemeral: false });
      if (response.error)
        throw new Error(
          "无法恢复／创建会话：" + String((response.error as any).message)
        );
      threadId = (response.result as any)?.thread?.id;
      if (!threadId) throw new Error("Codex did not return a thread ID");
      if (state && !resetThread && state.threadId !== threadId)
        throw new Error("Unexpected session replacement");
      if (resetThread) {
        contextUsage = {};
        if (state?.pdf) state.pdf.completedPages = 0;
      }
      state ??= {
        version: 1,
        projectId: trigger.projectId,
        threadId,
        updatedAt: new Date().toISOString(),
      };
      state.threadId = threadId;
      state.codexHome = codexHome;
      state.codexCwd = cwd;
      activeProjectId = trigger.projectId;
      activeProjectDir = projectDir;
      activeThreadId = threadId;
      activeState = state;
    }
    if (!state) throw new Error("Codex session state was not initialized");
    // Store the canonical path after the legacy data-directory migration. A
    // symlink path can otherwise make the same Codex thread look like it has
    // two different workspaces after the extension reconnects.
    state.codexCwd = cwd;
    state.codexHome = codexHome;
    if (pdfData) {
      if (!state.pdf || state.pdf.sha256 !== pdfData.sha256)
        state.pdf = {
          sha256: pdfData.sha256,
          pages: pages.length,
          completedPages: 0,
          compiledAt: pdfData.compiledAt,
        };
      state.contextUsage = contextUsage;
      saveState(projectDir, state);
      for (let i = state.pdf.completedPages; i < pages.length; i += 8) {
        const batch = pages.slice(i, i + 8);
        send({
          type: "status",
          text: `正在读取 PDF 图片第 ${i + 1}–${i + batch.length} 页，共 ${
            pages.length
          } 页…`,
        });
        const input = pdfBatchInput(batch, pdfData.compiledAt, pages.length);
        await runTurn(threadId, input);
        state.pdf.completedPages = i + batch.length;
        state.contextUsage = contextUsage;
        saveState(projectDir, state);
      }
    }
    state.contextUsage = contextUsage;
    saveState(projectDir, state);
    send({
      type: "status",
      text: "Astra 已恢复项目上下文，正在处理指令…",
      threadId,
    });
    const text = await runTurn(
      threadId,
      commandInput({
        request: trigger.prompt,
        requestedAt: new Date().toISOString(),
        pdfSnapshotAt: state.pdf?.compiledAt,
        reviewEvents: undelivered,
        feedbackReviewId: trigger.feedbackReviewId,
        commentContext,
      })
    );
    state.reviewEventIds = [
      ...new Set([
        ...(state.reviewEventIds ?? []),
        ...reviews.map((event) => event.id),
      ]),
    ];
    state.reviewHistory = [
      ...(state.reviewHistory ?? []),
      ...reviews.filter((event) => event.status === "accepted"),
    ].slice(-100);
    state.contextUsage = contextUsage;
    saveState(projectDir, state);
    send({ type: "delta", text });
    send({
      type: "done",
      threadId,
      ackReviewEventIds: reviews.map((event) => event.id),
    });
  } catch (error) {
    await cleanupJob();
    send({ type: "done", error: String((error as Error).message) });
  }
}
const queue = createSerialJobQueue(async (trigger: any) => {
  if (activeProjectId && activeProjectId !== trigger.projectId)
    await cleanupJob();
  currentJobId = trigger.id;
  send({ type: "queued_started", position: 0 });
  await start(trigger);
  currentJobId = null;
  if (queue.size === 0) {
    // Keep the app-server alive briefly after a turn. This lets the next
    // queued/nearby comment reuse the loaded thread instead of killing the
    // writer and immediately trying to resume the same thread in a new
    // process. There is no user-facing retry or wait state.
    idleCleanupTimer = setTimeout(() => {
      idleCleanupTimer = null;
      if (queue.size === 0) void cleanupJob();
    }, 60_000);
  }
});
process.stdin.on("data", (chunk: Buffer) => {
  const decoded = decodeNativeMessages(Buffer.concat([carry, chunk]));
  carry = decoded.carry as Buffer;
  for (const message of decoded.messages) {
    const m = message as any;
    if (m.type === "start") {
      if (idleCleanupTimer) {
        clearTimeout(idleCleanupTimer);
        idleCleanupTimer = null;
      }
      const position = queue.enqueue(m.trigger);
      send({ type: "queued", jobId: m.trigger.id, position });
    }
    if (m.type === "browser_response") {
      const p = pending.get(m.id);
      if (!p) continue;
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    }
  }
});
for (const event of ["end", "close"] as const)
  process.stdin.once(event, () => {
    void cleanup().finally(() => process.exit(0));
  });
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(0));
});
