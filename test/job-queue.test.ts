import test from "node:test";
import assert from "node:assert/strict";
import { createSerialJobQueue } from "../host/job-queue.js";

test("project jobs are acknowledged immediately and run in submission order", async () => {
  const started: string[] = [];
  const release: (() => void)[] = [];
  const queue = createSerialJobQueue(async (job: string) => {
    started.push(job);
    await new Promise<void>((resolve) => release.push(resolve));
  });
  assert.equal(queue.enqueue("A"), 1);
  assert.equal(queue.enqueue("B"), 2);
  assert.equal(queue.enqueue("C"), 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["A"]);
  release.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["A", "B"]);
  release.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["A", "B", "C"]);
  release.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.running, false);
});

test("a failed job does not discard later queued work", async () => {
  const seen: string[] = [];
  const queue = createSerialJobQueue(async (job: string) => {
    seen.push(job);
    if (job === "bad") throw new Error("expected");
  });
  queue.enqueue("bad");
  queue.enqueue("good");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["bad", "good"]);
});
