import { locateEdit, type EditScope } from "./edit-scope";
import {
  BOT_TRIGGER,
  BOT_REQUEST,
  BOT_RESPONSE,
  parseBotCommand,
} from "./protocol";
import {
  anchorFromElement,
  findThreadAnchor,
  documentBasename,
  sourceContext,
  type CommentAnchor,
} from "./comment-context";
import { registerEditorBridge } from "./legacy/editorBridge/bridge";

// No timers, scans, API polling or agent process at page load.
const originalFetch = window.fetch.bind(window);
const submitted = new Map<
  string,
  {
    path: string;
    headers: Headers;
    projectId: string;
    threadId?: string;
    anchor?: CommentAnchor;
    editScope?: EditScope;
  }
>();
let lastInput: { text: string; at: number; target: HTMLElement } | null = null;
let bridgeReady = false;
const pdfs = new Map<string, Uint8Array>();
function rememberInput(event: Event) {
  if (!event.isTrusted) return;
  // Overleaf comment inputs are CodeMirror instances inside open shadow roots.
  // Their paste handler can update state without a native input event.
  let target = event
    .composedPath()
    .find(
      (node) =>
        node instanceof HTMLElement &&
        node.matches('textarea, input, [contenteditable="true"]')
    ) as HTMLElement | undefined;
  if (!target) {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement;
    if (active instanceof HTMLElement) target = active;
  }
  if (
    !target ||
    target.closest("#ageaf-bot-result, #ageaf-panel-root") ||
    /^Source Editor/i.test(target.getAttribute("aria-label") ?? "")
  )
    return;
  const remember = () => {
    const view = (target as any)?.cmView?.view;
    const text =
      view?.state?.doc?.toString() ??
      (target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement
        ? target.value
        : target?.textContent ?? "");
    if (/^\s*@bot(?:\s|[，,:：])/i.test(text))
      lastInput = { text, at: Date.now(), target: target! };
  };
  remember();
  queueMicrotask(remember);
}
for (const name of ["input", "keydown", "paste", "pointerdown"])
  document.addEventListener(name, rememberInput, true);

window.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  // Overleaf's fetch-json passes JSON in init.body. Do not inspect unrelated bodies.
  const parsed = parseBotCommand(url, method, init?.body, location.origin);
  const trusted =
    parsed &&
    lastInput &&
    Date.now() - lastInput.at < 300000 &&
    lastInput.text.trim() === parsed.content.trim() &&
    location.pathname.split("/")[2] === parsed.projectId;
  const candidate =
    trusted && parsed?.threadId
      ? anchorFromElement(lastInput!.target)
      : undefined;
  const anchor =
    candidate && (candidate.threadId === parsed?.threadId || candidate.draft)
      ? candidate
      : undefined;
  if (trusted) lastInput = null; // consume the gesture before awaiting network
  const response = await originalFetch(input, init);
  if (trusted && parsed && response.ok) {
    const id = crypto.randomUUID();
    submitted.set(id, {
      path: new URL(url, location.origin).pathname,
      headers: new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      ),
      projectId: parsed.projectId,
      threadId: parsed.threadId,
      anchor,
    });
    window.dispatchEvent(
      new CustomEvent(BOT_TRIGGER, {
        detail: {
          id,
          projectId: parsed.projectId,
          threadId: parsed.threadId,
          prompt: parsed.prompt,
        },
      })
    );
  }
  return response;
};

function editorRequest(
  requestEvent: string,
  responseEvent: string,
  detail: object
): Promise<any> {
  if (!bridgeReady) {
    registerEditorBridge();
    bridgeReady = true;
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (e: Event) => {
      const result = (e as CustomEvent).detail;
      if (result?.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener(responseEvent, finish);
      result.ok === false
        ? reject(new Error(result.error ?? "Editor operation failed"))
        : resolve(result);
    };
    const timer = setTimeout(() => {
      window.removeEventListener(responseEvent, finish);
      reject(new Error("Editor request timed out"));
    }, 15000);
    window.addEventListener(responseEvent, finish);
    window.dispatchEvent(
      new CustomEvent(requestEvent, { detail: { ...detail, requestId } })
    );
  });
}

async function prepareFile(projectId: string, filePath: unknown) {
  if (
    typeof filePath !== "string" ||
    !filePath ||
    filePath.split("/").includes("..")
  )
    throw new Error("Invalid file path");
  const normalized = filePath.replace(/^\/+/, "");
  const response = await originalFetch(`/project/${projectId}/entities`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Cannot verify target file");
  const data = await response.json();
  const paths = (data.entities ?? []).map((entry: any) =>
    String(entry.path).replace(/^\/+/, "")
  );
  if (!paths.includes(normalized))
    throw new Error("Target file is not in this project");
  const base = normalized.split("/").pop();
  if (
    paths.filter((entry: string) => entry.split("/").pop() === base).length !==
    1
  )
    throw new Error(
      "Ambiguous filename: duplicate basenames are not supported by this editor bridge"
    );
  const tree = document.querySelector(
    '[role="tab"][aria-label="File tree"]'
  ) as HTMLElement | null;
  if (tree && tree.getAttribute("aria-selected") !== "true") {
    tree.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return normalized;
}

async function runBrowserTool(
  jobId: string,
  method: string,
  args: any
): Promise<any> {
  const scope = submitted.get(jobId);
  if (!scope || location.pathname.split("/")[2] !== scope.projectId)
    throw new Error("Project changed or command expired");
  if (method === "compile_pdf") {
    const headers = new Headers(scope.headers);
    headers.set("Content-Type", "application/json");
    const editorId = crypto.randomUUID();
    const response = await originalFetch(
      `/project/${scope.projectId}/compile`,
      {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          check: "silent",
          draft: false,
          incrementalCompilesEnabled: true,
          editorId,
        }),
        signal: AbortSignal.timeout(300000),
      }
    );
    if (!response.ok)
      throw new Error(`Compilation request failed (${response.status})`);
    const data = await response.json();
    if (data.status !== "success")
      throw new Error(
        "PDF 编译未成功，初始化已停止；不会把旧 PDF 当成新版读取。"
      );
    const output = (data.outputFiles ?? []).find(
      (file: any) => file.path === "output.pdf"
    );
    if (!output) throw new Error("Compilation returned no PDF");
    const params = new URLSearchParams({
      compileGroup: data.compileGroup ?? "standard",
      editorId,
    });
    if (data.clsiServerId) params.set("clsiserverid", data.clsiServerId);
    const url = new URL(
      output.downloadURL ??
        `/download/project/${scope.projectId}/build/${output.build}/output/output.pdf?${params}`,
      location.origin
    );
    if (url.origin !== location.origin)
      throw new Error("Unexpected PDF download origin");
    const download = await originalFetch(url, { credentials: "same-origin" });
    if (!download.ok)
      throw new Error(`PDF download failed (${download.status})`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024)
      throw new Error("PDF exceeds 100 MiB");
    const pdfId = jobId;
    pdfs.set(pdfId, bytes);
    return { pdfId, size: bytes.length, compiledAt: new Date().toISOString() };
  }
  if (method === "pdf_chunk") {
    if (args.pdfId !== jobId) throw new Error("PDF scope mismatch");
    const pdf = pdfs.get(jobId),
      offset = args.offset;
    if (
      !pdf ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= pdf.length
    )
      throw new Error("Invalid PDF offset");
    const part = pdf.subarray(offset, Math.min(pdf.length, offset + 262144));
    let binary = "";
    for (let i = 0; i < part.length; i += 8192)
      binary += String.fromCharCode(...part.subarray(i, i + 8192));
    if (offset + part.length === pdf.length) pdfs.delete(jobId);
    return { base64: btoa(binary) };
  }
  if (method === "list_files") {
    const response = await originalFetch(
      `/project/${scope.projectId}/entities`,
      { credentials: "same-origin" }
    );
    if (!response.ok) throw new Error(`File list failed (${response.status})`);
    return response.json();
  }
  if (method === "read_selection") {
    return editorRequest("ageaf:editor:request", "ageaf:editor:response", {});
  }
  if (method === "read_comments") {
    if (!scope.threadId)
      return { messages: [], note: "This command came from project chat." };
    const response = await originalFetch(
      `/project/${scope.projectId}/threads`,
      { credentials: "same-origin" }
    );
    if (!response.ok)
      throw new Error(`Comments unavailable (${response.status})`);
    const data = await response.json();
    return data[scope.threadId] ?? { messages: [] };
  }
  if (method === "comment_context") {
    if (!scope.threadId) return { note: "Project chat has no comment anchor." };
    scope.editScope = undefined;
    const context: any = { threadId: scope.threadId, anchorAvailable: false };
    try {
      context.discussion = await runBrowserTool(jobId, "read_comments", {});
    } catch (error) {
      context.discussionError = String((error as Error).message);
    }
    try {
      const anchor = findThreadAnchor(scope.threadId) ?? scope.anchor;
      if (!anchor)
        throw new Error("Comment anchor is unavailable in this editor layout.");
      context.docId = anchor.docId;
      // Preserve the user's captured TeX even if opening/validating its file fails.
      context.selectedText = {
        text: anchor.text,
        docId: anchor.docId,
        from: anchor.from,
        to: anchor.from + anchor.text.length,
        verified: false,
      };
      const basename = documentBasename(anchor.docId);
      if (!basename)
        throw new Error("Cannot identify the comment's source file.");
      const files = await runBrowserTool(jobId, "list_files", {});
      const paths = (files.entities ?? []).filter(
        (entry: any) =>
          entry.type === "doc" &&
          String(entry.path).split("/").pop() === basename
      );
      if (paths.length !== 1)
        throw new Error("Comment filename is missing or ambiguous.");
      const filePath = String(paths[0].path).replace(/^\/+/, "");
      context.filePath = filePath;
      context.selectedText.filePath = filePath;
      const file = await runBrowserTool(jobId, "read_file", { filePath });
      Object.assign(
        context,
        sourceContext(String(file.content), anchor, filePath)
      );
      if (context.anchorAvailable) {
        context.selectedText.verified = true;
        if (context.paragraph) {
          scope.editScope = {
            filePath,
            from: context.paragraph.from,
            text: context.paragraph.text,
          };
          context.editableRange = {
            filePath,
            ...context.paragraph,
          };
        }
      }
    } catch (error) {
      context.note = String((error as Error).message);
    }
    return context;
  }
  if (method === "read_file") {
    const filePath = await prepareFile(scope.projectId, args.filePath);
    const file = await editorRequest(
      "ageaf:editor:file-content:request",
      "ageaf:editor:file-content:response",
      // prepareFile already verified project membership and basename uniqueness.
      { name: filePath.split("/").pop()! }
    );
    return { ...file, name: filePath, filePath };
  }
  if (method === "validate_edit") {
    if (scope.threadId && !scope.editScope)
      throw new Error(
        "评论没有可验证的目标段落，请在一个段落内选中关注的文字重新评论；本次可讨论但不能修改。"
      );
    const file = await runBrowserTool(jobId, "read_file", {
      filePath: args.filePath,
    });
    return locateEdit(String(file.content), args, scope.editScope);
  }
  if (method === "apply_edit") {
    const edit = await runBrowserTool(jobId, "validate_edit", args);
    const filePath = await prepareFile(scope.projectId, args.filePath);
    // The legacy bridge first searches the active document, so explicitly switch
    // and verify the target before allowing it to replace anything.
    await editorRequest(
      "ageaf:editor:file-navigate:request",
      "ageaf:editor:file-navigate:response",
      // prepareFile already verified project membership and basename uniqueness.
      { name: filePath.split("/").pop()! }
    );
    const selection = await editorRequest(
      "ageaf:editor:request",
      "ageaf:editor:response",
      {}
    );
    const base = filePath.split("/").pop();
    if (String(selection.activeName).split("/").pop() !== base)
      throw new Error("Could not verify active target document");
    return editorRequest(
      "ageaf:editor:apply:request",
      "ageaf:editor:apply:response",
      {
        kind: "replaceInFile",
        filePath,
        expectedOldText: args.oldText,
        text: args.newText,
        from: edit.from,
        to: edit.to,
        strictRange: true,
      }
    );
  }
  if (method === "reply") {
    const isReview =
      typeof args.reviewId === "string" &&
      /^[a-zA-Z0-9-]{1,100}$/.test(args.reviewId);
    if (isReview && String(args.text).length > 20000)
      throw new Error("反馈超过评论长度限制，请缩短后手动发送。");
    const content = `${
      isReview ? "[用户审阅 · @bot建议]" : "[bot · GPT-6 Astra]"
    }\n${String(args.text).slice(0, 20000)}`;
    if (isReview && args.retry) {
      let data;
      if (scope.threadId)
        data = await runBrowserTool(jobId, "read_comments", {});
      else {
        const response = await originalFetch(scope.path, {
          credentials: "same-origin",
        });
        if (!response.ok)
          throw new Error("无法检查评论是否已发送，请稍后重试。");
        data = await response.json();
      }
      const messages = Array.isArray(data) ? data : data?.messages;
      if (!Array.isArray(messages))
        throw new Error("无法确认评论发送状态，请稍后重试。");
      if (messages.some((m: any) => m.content === content))
        return { ok: true, alreadySent: true };
    }
    const headers = new Headers(scope.headers);
    headers.set("Content-Type", "application/json");
    const response = await originalFetch(scope.path, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({
        content,
      }),
    });
    if (!response.ok) throw new Error(`Reply failed (${response.status})`);
    return { ok: true };
  }
  throw new Error("Unknown browser tool");
}
window.addEventListener(BOT_REQUEST, (event: Event) => {
  const { id, jobId, method, args } = (event as CustomEvent).detail ?? {};
  if (typeof id !== "string" || !submitted.has(jobId)) return;
  void runBrowserTool(jobId, method, args ?? {}).then(
    (result) =>
      window.dispatchEvent(
        new CustomEvent(BOT_RESPONSE, { detail: { id, result } })
      ),
    (error) =>
      window.dispatchEvent(
        new CustomEvent(BOT_RESPONSE, {
          detail: { id, error: String(error.message ?? error) },
        })
      )
  );
});
