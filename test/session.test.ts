import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  projectDirectory,
  readState,
  saveState,
  lockProject,
} from "../host/session.js";
test("one saved thread per project, with independent PDF progress and exclusive lock", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-bot-test-"));
  try {
    const projectId = "0123456789abcdef01234567",
      dir = projectDirectory(projectId, root);
    assert.equal(readState(dir), null);
    const release = lockProject(dir);
    assert.throws(() => lockProject(dir), /正在处理/);
    const s = {
      version: 1 as const,
      projectId,
      threadId: "thread-1",
      updatedAt: "now",
      pdf: { sha256: "abc", pages: 12, completedPages: 8, compiledAt: "now" },
    };
    saveState(dir, s);
    assert.equal(readState(dir)?.threadId, "thread-1");
    assert.equal(readState(dir)?.pdf?.completedPages, 8);
    release();
    const second = lockProject(dir);
    second();
    const other = projectDirectory("1123456789abcdef01234567", root);
    assert.equal(readState(other), null);
    assert.throws(() => projectDirectory("../outside", root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("corrupt saved sessions fail visibly instead of starting a replacement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-bot-test-"));
  try {
    fs.writeFileSync(path.join(dir, "session.json"), "{}");
    assert.throws(() => readState(dir), /refusing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
