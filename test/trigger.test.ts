import test from "node:test";
import assert from "node:assert/strict";
import { parseBotCommand } from "../extension/protocol.js";
const origin = "https://www.overleaf.com",
  project = "0123456789abcdef01234567",
  url = `/project/${project}/messages`;
test("chat and comment submissions parse explicit bot commands", () => {
  for (const endpoint of [url, `/project/${project}/thread/abc123/messages`])
    assert.equal(
      parseBotCommand(
        endpoint,
        "POST",
        JSON.stringify({ content: "@bot 修改引言" }),
        origin
      )?.prompt,
      "修改引言"
    );
});
test("historical reads, message edits and other sites never trigger", () => {
  const body = JSON.stringify({ content: "@bot test" });
  assert.equal(parseBotCommand(url, "GET", body, origin), null);
  assert.equal(parseBotCommand(url + "/id/edit", "POST", body, origin), null);
  assert.equal(
    parseBotCommand("https://example.com" + url, "POST", body, origin),
    null
  );
  for (const content of [
    "@bot",
    "hello @bot test",
    "[bot · GPT-6 Astra] @bot test",
  ])
    assert.equal(
      parseBotCommand(url, "POST", JSON.stringify({ content }), origin),
      null
    );
});
