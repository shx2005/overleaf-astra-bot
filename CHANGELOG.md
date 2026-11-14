# Changelog

## 1.0.1 — Unreleased

- Treat selected words as the focus and the containing TeX paragraph as the editable scope, allowing sentence restructuring while keeping other paragraphs unchanged.
- Replace stacked conversation panels with a single work panel and one visible suggestion; retain pending suggestions behind previous/next navigation and remove resolved cards.

## v1.0 — 2026-11-14

First public release of the standalone Overleaf Astra Bot.

- Invoke GPT-6 Astra through an explicit `@bot` comment or project chat. No idle polling or permanent model process.
- Keep one persistent Codex conversation per Overleaf project, protected by a project lock.
- Initialize the paper context using images of every compiled PDF page, in batches of up to eight. No extracted PDF body text or OCR is sent.
- Send the selected TeX as a separate text item, with its file, exact character range, surrounding paragraphs, section and comment discussion.
- Restrict comment edits to the selected character range. Stage each change for acceptance, rejection or rejection with feedback, then carry decisions into subsequent calls.
- Validate the target and source again on acceptance; refuse stale ranges and ambiguous duplicate filenames.
- Support nested source paths such as `sec/1_intro.tex` while retaining full paths in model-facing results.
- Preserve captured selection text when source validation fails; allow discussion but prevent unverified edits.
- Detect invalidated extension pages after an update and provide explicit refresh guidance without discarding saved history.

- Display per-project context usage in the result panel, including reported/configured window capacity, compact threshold guidance and compaction progress.
- Publish rejection decisions and feedback to the original comment/chat; preserve local decisions on delivery failure and offer a duplicate-aware retry.

### Installation and validation

- Requires Chrome, Node.js 22+, Poppler and an authenticated Codex installation with GPT-6 Astra access. macOS and Linux installation scripts are included.
- The release ZIP includes source and the prebuilt Chrome extension. Run `npm ci`, follow README installation steps and register the native host for your extension ID.
- Validated with 43 automated regression tests, TypeScript checking, production builds, and a live two-page image-only PDF test covering persistent conversation memory MCP reconnection and actual token-usage notifications.
- Windows, self-hosted Overleaf and visual-editor mode have not been verified. Pending proposal cards remain local to the open page.

The project retains MIT attribution for adapted code from OniReimu/Ageaf. Existing user conversation history is not reset by this release.
