const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function harness() {
  const listeners = new Map(),
    elements = [],
    saved = [],
    sent = [],
    calls = [],
    requests = [];
  let handler,
    connected = 0,
    failApply = false,
    failSave = false,
    failReply = false;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.style = {};
      this.textContent = "";
      this.children = [];
      this.parentNode = null;
      this.attributes = {};
      elements.push(this);
    }
    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        this.children.push(node);
        node.parentNode = this;
      }
    }
    replaceChildren(...nodes) {
      for (const node of [...this.children]) node.remove();
      this.append(...nodes);
    }
    setAttribute(k, v) {
      this.attributes[k] = v;
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter(
          (n) => n !== this
        );
      this.parentNode = null;
    }
    focus() {}
    querySelector() {
      return null;
    }
    get isConnected() {
      return (
        this === context.document.body || Boolean(this.parentNode?.isConnected)
      );
    }
  }
  const window = {
    setTimeout,
    addEventListener: (n, f) => listeners.set(n, f),
    dispatchEvent(e) {
      if (e.type === "ageaf:bot:request") {
        calls.push(e.detail.method);
        requests.push(e.detail);
        const error =
          (e.detail.method === "apply_edit" && failApply) ||
          (e.detail.method === "reply" && failReply)
            ? "apply failed"
            : undefined;
        listeners.get("ageaf:bot:response")({
          detail: {
            id: e.detail.id,
            result:
              e.detail.method === "validate_edit"
                ? { ...e.detail.args, from: 0, to: 3, line: 1 }
                : { content: "old" },
            error,
          },
        });
      } else return listeners.get(e.type)?.(e);
    },
  };
  const context = {
    exports: {},
    window,
    document: {
      getElementById: (id) =>
        elements.find((e) => e.id === id && e.isConnected) ?? null,
      createElement: (tag) => new Element(tag),
      body: new Element(),
    },
    crypto: require("node:crypto").webcrypto,
    clearTimeout,
    console,
    CustomEvent: class {
      constructor(type, { detail }) {
        this.type = type;
        this.detail = detail;
      }
    },
    chrome: {
      storage: { local: {} },
      runtime: {
        id: "test-extension",
        connect: () => {
          connected++;
          return {
            postMessage: (m) => sent.push(m),
            disconnect() {},
            onMessage: { addListener: (f) => (handler = f) },
            onDisconnect: { addListener() {} },
          };
        },
      },
    },
    require(n) {
      if (n.includes("review-deck")) {
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync("extension/review-deck.ts", "utf8"),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            }
          ).outputText,
          { exports, document: context.document }
        );
        return exports;
      }
      if (n.includes("review-comment")) {
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync("extension/review-comment.ts", "utf8"),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            }
          ).outputText,
          { exports }
        );
        return exports;
      }
      if (n.includes("context-usage")) {
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync("extension/context-usage.ts", "utf8"),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            }
          ).outputText,
          { exports }
        );
        return exports;
      }
      if (n.includes("extension-context")) {
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync("extension/extension-context.ts", "utf8"),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            }
          ).outputText,
          { exports, chrome: context.chrome, Error }
        );
        return exports;
      }
      if (n.includes("reviews"))
        return {
          pendingReviews: async () => saved.slice(),
          saveReview: async (e) => {
            if (failSave) throw Error("storage failed");
            saved.push(e);
          },
          acknowledgeReviews: async () => {},
        };
      return {
        BOT_TRIGGER: "ageaf:bot:trigger",
        BOT_REQUEST: "ageaf:bot:request",
        BOT_RESPONSE: "ageaf:bot:response",
      };
    },
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("extension/isolated.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context
  );
  return {
    saved,
    invalidate: () => {
      context.chrome.runtime.id = undefined;
      context.chrome.storage = undefined;
    },
    messages: () =>
      elements
        .filter((e) => e.isConnected)
        .map((e) => e.textContent)
        .join("\n"),
    visibleCards: () =>
      elements.filter((e) => e.tagName === "details" && e.isConnected).length,
    panelRounds: () =>
      context.document.getElementById("ageaf-bot-result")?.children.length ?? 0,
    delta: async (text) => handler({ type: "delta", text }),
    addProposal: async (newText = "new") =>
      handler({
        type: "browser_request",
        id: "proposal-extra",
        method: "propose_edit",
        args: { filePath: "main.tex", oldText: "old", newText },
      }),
    sent,
    calls,
    requests,
    setFailReply: (value) => (failReply = value),
    feedback: (text) => {
      const e = elements.find((e) => e.placeholder && e.isConnected);
      e.value = text;
    },
    setFailApply: (v) => (failApply = v),
    setFailSave: (v) => (failSave = v),
    get connected() {
      return connected;
    },
    click: async (text) => {
      const e = elements.find((e) => e.isConnected && e.textContent === text);
      assert.ok(e, text);
      await e.onclick({ isTrusted: true });
    },
    async proposal(id = "turn") {
      await listeners.get("ageaf:bot:trigger")({
        detail: {
          id,
          projectId: "0123456789abcdef01234567",
          prompt: "edit",
        },
      });
      if (!handler) return;
      await handler({
        type: "browser_request",
        id: "proposal",
        method: "propose_edit",
        args: { filePath: "main.tex", oldText: "old", newText: "new" },
      });
    },
    async usage(value, cached = false) {
      await handler({ type: "context_usage", usage: value, cached });
    },
    async done() {
      await handler({ type: "done" });
    },
  };
}
test("accept records only successful writes; storage retry does not apply twice", async () => {
  const h = harness();
  await h.proposal();
  h.setFailApply(true);
  await h.click("接受修改");
  assert.equal(h.saved.length, 0);
  h.setFailApply(false);
  h.setFailSave(true);
  await h.click("接受修改");
  assert.equal(h.saved.length, 0);
  const count = h.calls.filter((x) => x === "apply_edit").length;
  h.setFailSave(false);
  await h.click("已应用，重试保存记录");
  assert.equal(h.saved[0].status, "accepted");
  assert.equal(h.calls.filter((x) => x === "apply_edit").length, count);
  assert.equal(h.connected, 1);
});
test("reject is recorded and published without waking another model or applying edits", async () => {
  const h = harness();
  await h.proposal();
  await h.done();
  await h.click("拒绝");
  assert.equal(h.saved[0].status, "rejected");
  const published = h.requests.find(
    (r) => r.method === "reply" && r.args.reviewId
  );
  assert.ok(published.args.text.includes("未采用的建议：\nnew"));
  assert.equal(published.args.reviewId, h.saved[0].id);
  assert.equal(h.connected, 1);
  assert.ok(!h.calls.includes("apply_edit"));
});

test("reject with feedback saves the decision before starting the next project turn", async () => {
  const h = harness();
  await h.proposal();
  await h.done();
  h.feedback("Preserve the citation");
  await h.click("发送修改指令");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.saved[0].status, "rejected_with_feedback");
  assert.equal(h.saved[0].feedback, "Preserve the citation");
  assert.ok(
    h.requests
      .find((r) => r.args.reviewId)
      ?.args.text.includes("Preserve the citation")
  );
  const starts = h.sent.filter((m) => m.type === "start");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].trigger.reviewEvents[0].id, h.saved[0].id);
  assert.equal(starts[1].trigger.projectId, starts[0].trigger.projectId);
  assert.equal(starts[1].trigger.prompt, "Preserve the citation");
  assert.equal(starts[1].trigger.feedbackReviewId, h.saved[0].id);
});

test("invalidated page resets busy state and offers refresh without starting native host", async () => {
  const h = harness();
  h.invalidate();
  await h.proposal();
  assert.equal(h.connected, 0);
  assert.match(h.messages(), /任务未启动.*扩展已更新/);
  assert.match(h.messages(), /已保存，刷新页面/);
});
test("invalidation after a proposal prevents applying an unrecordable edit", async () => {
  const h = harness();
  await h.proposal();
  await h.done();
  h.invalidate();
  await h.click("接受修改");
  assert.ok(!h.calls.includes("apply_edit"));
  assert.match(h.messages(), /修改未应用.*扩展已更新/);
});

test("failed review publication can retry without recording or running the model twice", async () => {
  const h = harness();
  await h.proposal();
  await h.done();
  h.setFailReply(true);
  await h.click("拒绝");
  assert.equal(h.saved.length, 1);
  assert.match(h.messages(), /评论同步未确认/);
  h.setFailReply(false);
  await h.click("重试同步评论");
  await new Promise((r) => setImmediate(r));
  assert.equal(h.saved.length, 1);
  assert.equal(h.connected, 1);
  assert.equal(
    h.requests.filter((r) => r.args.reviewId).at(-1).args.retry,
    true
  );
  assert.equal(h.visibleCards(), 0);
});
test("context badge reports current usage and persists when the task completes", async () => {
  const h = harness();
  await h.proposal();
  await h.usage({
    usedTokens: 420000,
    contextWindow: 486400,
    windowSource: "codex",
    autoCompactLimit: 460000,
  });
  assert.match(h.messages(), /420k/);
  assert.match(h.messages(), /486.4k/);
  await h.done();
  assert.match(h.messages(), /420k/);
});

test("one work panel shows one suggestion at a time and advances after a decision", async () => {
  const h = harness();
  await h.proposal();
  await h.addProposal("Second replacement");
  await h.done();
  assert.equal(h.panelRounds(), 1);
  assert.equal(h.visibleCards(), 1);
  assert.match(h.messages(), /当前修改 2 \/ 2/);
  assert.match(h.messages(), /Second replacement/);
  await h.click("上一处");
  assert.equal(h.visibleCards(), 1);
  assert.ok(!h.messages().includes("Second replacement"));
  await h.click("拒绝");
  assert.equal(h.visibleCards(), 1);
  assert.match(h.messages(), /Second replacement/);
  await h.click("接受修改");
  assert.equal(h.visibleCards(), 0);
  assert.match(h.messages(), /暂无待处理修改/);
});
test("new calls replace the previous round without discarding older pending suggestions", async () => {
  const h = harness();
  await h.proposal("first");
  await h.delta("OLD ANSWER MUST NOT ACCUMULATE");
  await h.done();
  await h.proposal("second");
  assert.equal(h.panelRounds(), 1);
  assert.equal(h.visibleCards(), 1);
  assert.match(h.messages(), /当前修改 2 \/ 2/);
  assert.ok(!h.messages().includes("OLD ANSWER MUST NOT ACCUMULATE"));
  await h.click("上一处");
  await h.click("接受修改");
  assert.equal(h.saved[0].proposalId, "first:1");
});
