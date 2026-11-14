const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("extension/protocol.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: exportsObject, URL }
);
const parse = exportsObject.parseBotCommand;
const origin = "https://www.overleaf.com",
  project = "0123456789abcdef01234567",
  path = `/project/${project}/messages`;
test("new project chats and comment replies accept @bot with a task", () => {
  for (const url of [path, `/project/${project}/thread/abcdef123/messages`]) {
    const result = parse(
      url,
      "POST",
      JSON.stringify({ content: "@bot 帮我润色引言" }),
      origin
    );
    assert.equal(result.prompt, "帮我润色引言");
    assert.equal(result.projectId, project);
  }
});
test("reads, edits, foreign origins, bot replies and accidental mentions never trigger", () => {
  const body = JSON.stringify({ content: "@bot test" });
  for (const [url, method, text] of [
    [path, "GET", body],
    [path + "/old/edit", "POST", body],
    ["https://example.com" + path, "POST", body],
    [
      path,
      "POST",
      JSON.stringify({ content: "[bot · GPT-6 Astra]\n@bot test" }),
    ],
    [path, "POST", JSON.stringify({ content: "tell @bot to do something" })],
    [path, "POST", JSON.stringify({ content: "@bot" })],
    [path, "POST", "invalid"],
  ])
    assert.equal(parse(url, method, text, origin), null);
});
test("only lightweight entrypoints are injected at startup", () => {
  const m = JSON.parse(fs.readFileSync("dist/extension/manifest.json", "utf8"));
  assert.deepEqual(
    m.content_scripts.flatMap((s) => s.js),
    ["botMain.js", "botIsolated.js"]
  );
  for (const s of m.content_scripts) assert.equal(s.run_at, "document_start");
  for (const file of ["extension/main.ts", "extension/isolated.ts"])
    assert.ok(!fs.readFileSync(file, "utf8").includes("setInterval("));
});
function harness(options = {}) {
  const listeners = new Map(),
    windowListeners = new Map(),
    events = [],
    network = [];
  let ok = true,
    activeName = options.activeName ?? "main.tex";
  class Element {
    constructor(text) {
      this.textContent = text;
      this.cmView = {
        view: { state: { doc: { toString: () => this.textContent } } },
      };
    }
    matches() {
      return true;
    }
    closest() {
      return null;
    }
    getAttribute() {
      return "Reply";
    }
  }
  class Textarea extends Element {}
  class Input extends Element {}
  const document = {
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const window = {
    fetch: async (url, init) => {
      network.push({ url, init });
      return {
        ok,
        json: async () => ({
          entities: (options.paths ?? ["main.tex"]).map((path) => ({
            path,
            type: "doc",
          })),
          messages: options.messages ?? [],
          abcdef123: { messages: options.messages ?? [] },
        }),
      };
    },
    addEventListener: (n, f) => windowListeners.set(n, f),
    removeEventListener: (n) => windowListeners.delete(n),
    dispatchEvent: (e) => {
      events.push(e);
      const responseNames = {
        "ageaf:editor:file-content:request":
          "ageaf:editor:file-content:response",
        "ageaf:editor:file-navigate:request":
          "ageaf:editor:file-navigate:response",
        "ageaf:editor:request": "ageaf:editor:response",
        "ageaf:editor:apply:request": "ageaf:editor:apply:response",
      };
      if (responseNames[e.type])
        windowListeners.get(responseNames[e.type])?.({
          detail: {
            requestId: e.detail.requestId,
            ok: !(
              options.readFailure &&
              e.type === "ageaf:editor:file-content:request"
            ),
            error: "File unavailable",
            activeName,
            content: "old",
          },
        });
    },
  };
  const context = {
    exports: {},
    require: (n) => {
      if (n.includes("protocol")) return exportsObject;
      if (n.includes("comment-context") || n.includes("edit-scope")) {
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync(
              n.includes("edit-scope")
                ? "extension/edit-scope.ts"
                : "extension/comment-context.ts",
              "utf8"
            ),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            }
          ).outputText,
          { exports, document }
        );
        if (options.comment && n.includes("comment-context")) {
          exports.anchorFromElement = () => ({
            docId: project,
            threadId: "draft",
            from: 0,
            text: "old",
            draft: true,
          });
          exports.documentBasename = () => activeName;
        }
        return exports;
      }
      return { registerEditorBridge() {} };
    },
    URL,
    Request,
    Headers,
    crypto: require("node:crypto").webcrypto,
    HTMLElement: Element,
    HTMLTextAreaElement: Textarea,
    HTMLInputElement: Input,
    document,
    window,
    location: { origin, pathname: `/project/${project}` },
    queueMicrotask: (fn) => fn(),
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("extension/main.ts", "utf8") +
        "\nexports.__call = runBrowserTool;",
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    context
  );
  return {
    events,
    network,
    call: (...args) => context.exports.__call(...args),
    setActive: (name) => {
      activeName = name;
    },
    post: (content) =>
      window.fetch(
        options.comment
          ? `/project/${project}/thread/abcdef123/messages`
          : path,
        { method: "POST", body: JSON.stringify({ content }) }
      ),
    setOK: (v) => (ok = v),
    input: (text, trusted = true) =>
      listeners.get("keydown")({
        isTrusted: trusted,
        composedPath: () => [new Element(text)],
      }),
  };
}
test("Shadow DOM comment input triggers once only after successful submission", async () => {
  const h = harness();
  h.input("@bot read main.tex");
  assert.equal(h.events.length, 0);
  await h.post("@bot read main.tex");
  assert.equal(h.events.length, 1);
  await h.post("@bot read main.tex");
  assert.equal(h.events.length, 1);
});
test("untrusted events and failed submissions do not wake the agent", async () => {
  const h = harness();
  h.input("@bot test", false);
  await h.post("@bot test");
  assert.equal(h.events.length, 0);
  h.input("@bot test");
  h.setOK(false);
  await h.post("@bot test");
  assert.equal(h.events.length, 0);
});

test("accepted edits navigate and verify the target before writing", async () => {
  const h = harness();
  h.input("@bot test");
  await h.post("@bot test");
  const id = h.events[0].detail.id;
  h.setActive("wrong.tex");
  await assert.rejects(
    h.call(id, "apply_edit", {
      filePath: "main.tex",
      oldText: "old",
      newText: "new",
    }),
    /verify active target/
  );
  assert.ok(!h.events.some((e) => e.type === "ageaf:editor:apply:request"));
  h.setActive("main.tex");
  await h.call(id, "apply_edit", {
    filePath: "main.tex",
    oldText: "old",
    newText: "new",
  });
  const writes = h.events.filter(
    (e) => e.type === "ageaf:editor:apply:request"
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].detail.strictRange, true);
  assert.equal(writes[0].detail.from, 0);
  assert.equal(writes[0].detail.to, 3);
});

test("nested TeX comment retains its selection and uses the unique basename for reading and applying", async () => {
  const h = harness({
    paths: ["sec/1_intro.tex"],
    activeName: "1_intro.tex",
    comment: true,
  });
  h.input("@bot polish this sentence");
  await h.post("@bot polish this sentence");
  const id = h.events[0].detail.id;
  const context = await h.call(id, "comment_context", {});
  assert.equal(context.anchorAvailable, true);
  assert.equal(context.filePath, "sec/1_intro.tex");
  assert.equal(context.selectedText.text, "old");
  assert.equal(context.selectedText.verified, true);
  assert.equal(context.editableRange.filePath, "sec/1_intro.tex");
  const file = await h.call(id, "read_file", { filePath: "sec/1_intro.tex" });
  assert.equal(file.name, "sec/1_intro.tex");
  assert.equal(file.filePath, "sec/1_intro.tex");
  await h.call(id, "apply_edit", {
    filePath: "sec/1_intro.tex",
    oldText: "old",
    newText: "new",
  });
  const reads = h.events.filter(
    (e) => e.type === "ageaf:editor:file-content:request"
  );
  assert.ok(reads.length > 0);
  assert.ok(reads.every((e) => e.detail.name === "1_intro.tex"));
  assert.equal(
    h.events.find((e) => e.type === "ageaf:editor:file-navigate:request").detail
      .name,
    "1_intro.tex"
  );
});
test("a file read failure preserves the captured selection but does not authorize edits", async () => {
  const h = harness({
    paths: ["sec/1_intro.tex"],
    activeName: "1_intro.tex",
    comment: true,
    readFailure: true,
  });
  h.input("@bot polish this sentence");
  await h.post("@bot polish this sentence");
  const id = h.events[0].detail.id;
  const context = await h.call(id, "comment_context", {});
  assert.equal(context.anchorAvailable, false);
  assert.equal(context.selectedText.text, "old");
  assert.equal(context.selectedText.verified, false);
  assert.equal(context.filePath, "sec/1_intro.tex");
  assert.match(context.note, /File unavailable/);
  await assert.rejects(
    h.call(id, "validate_edit", {
      filePath: "sec/1_intro.tex",
      oldText: "old",
      newText: "new",
    }),
    /没有可验证/
  );
});
test("basename routing never bypasses duplicate filename checks", async () => {
  const h = harness({
    paths: ["a/intro.tex", "b/intro.tex"],
    activeName: "intro.tex",
  });
  h.input("@bot test");
  await h.post("@bot test");
  await assert.rejects(
    h.call(h.events[0].detail.id, "read_file", { filePath: "a/intro.tex" }),
    /Ambiguous/
  );
  assert.ok(
    !h.events.some((e) => e.type === "ageaf:editor:file-content:request")
  );
});

test("review retry checks the original thread and avoids posting an acknowledged decision twice", async () => {
  const messages = [];
  const h = harness({ comment: true, messages });
  h.input("@bot test");
  await h.post("@bot test");
  const scopeId = h.events[0].detail.id;
  const args = {
    text: "审阅决定：拒绝\n审阅编号：review-1",
    reviewId: "review-1",
  };
  await h.call(scopeId, "reply", args);
  const posted = h.network.filter((r) => r.init?.method === "POST").at(-1);
  assert.ok(posted.url.includes("/thread/abcdef123/messages"));
  const content = JSON.parse(posted.init.body).content;
  assert.ok(content.startsWith("[用户审阅 · @bot建议]"));
  messages.push({ content });
  const count = h.network.filter((r) => r.init?.method === "POST").length;
  const retry = await h.call(scopeId, "reply", { ...args, retry: true });
  assert.equal(retry.alreadySent, true);
  assert.equal(
    h.network.filter((r) => r.init?.method === "POST").length,
    count
  );
});
