import { build } from "esbuild";
import fs from "node:fs/promises";
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
await fs.mkdir("dist/extension", { recursive: true });
await build({
  entryPoints: {
    botMain: "extension/main.ts",
    botIsolated: "extension/isolated.ts",
    background: "extension/background.ts",
  },
  bundle: true,
  outdir: "dist/extension",
  minify: true,
  target: "chrome120",
  platform: "browser",
});
await fs.writeFile(
  "dist/extension/manifest.json",
  JSON.stringify(
    {
      manifest_version: 3,
      name: "Overleaf Astra Bot",
      version,
      description:
        "Mention @bot in Overleaf comments or chat. Persistent Codex context, full PDF initialization and reviewed edits.",
      permissions: ["storage", "nativeMessaging"],
      background: { service_worker: "background.js" },
      action: { default_title: "Overleaf Astra Bot" },
      content_scripts: [
        {
          world: "MAIN",
          matches: ["https://www.overleaf.com/project/*"],
          run_at: "document_start",
          js: ["botMain.js"],
        },
        {
          matches: ["https://www.overleaf.com/project/*"],
          run_at: "document_start",
          js: ["botIsolated.js"],
        },
      ],
    },
    null,
    2
  ) + "\n"
);
