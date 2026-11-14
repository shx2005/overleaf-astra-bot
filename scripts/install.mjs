import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(0, i), s.slice(i + 1)];
  })
);
const id = args["--extension-id"];
if (!/^[a-p]{32}$/.test(id ?? ""))
  throw new Error(
    "Usage: npm run install:host -- --extension-id=CHROME_ID [--extension-dir=/existing/build]"
  );
const platform = os.platform();
if (!["darwin", "linux"].includes(platform))
  throw new Error("This installer supports macOS and Linux.");
const which = (name) => {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const desktop =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";
const codex =
  process.env.AGEAF_CODEX_CLI_PATH ??
  (fs.existsSync(desktop) ? desktop : which("codex"));
if (!codex) throw new Error("Install and log into Codex first.");
const bundled = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm"
);
const renderer =
  process.env.AGEAF_PDFTOPPM ??
  which("pdftoppm") ??
  (fs.existsSync(bundled) ? bundled : null);
if (!renderer)
  throw new Error(
    "Install Poppler (brew install poppler / apt install poppler-utils)."
  );
const support =
  platform === "darwin"
    ? path.join(os.homedir(), "Library/Application Support/Overleaf Astra Bot")
    : path.join(os.homedir(), ".local/share/overleaf-astra-bot");
fs.mkdirSync(support, { recursive: true, mode: 0o700 });
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const launcher = path.join(support, "native-host");
fs.writeFileSync(
  launcher,
  `#!/bin/sh\ncd ${quote(root)} || exit 1\nexport AGEAF_CODEX_CLI_PATH=${quote(
    codex
  )}\nexport AGEAF_PDFTOPPM=${quote(renderer)}\nexport PATH=${quote(
    [
      path.dirname(process.execPath),
      path.dirname(codex),
      "/usr/bin",
      "/bin",
    ].join(":")
  )}:"$PATH"\nexec ${quote(process.execPath)} --import ${quote(
    path.join(root, "node_modules/tsx/dist/loader.mjs")
  )} ${quote(path.join(root, "host/native.ts"))}\n`,
  { mode: 0o755 }
);
const manifests =
  platform === "darwin"
    ? path.join(
        os.homedir(),
        "Library/Application Support/Google/Chrome/NativeMessagingHosts"
      )
    : path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts");
fs.mkdirSync(manifests, { recursive: true });
fs.writeFileSync(
  path.join(manifests, "com.overleaf_astra.bot.json"),
  JSON.stringify(
    {
      name: "com.overleaf_astra.bot",
      description: "Overleaf Astra Bot native host",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${id}/`],
    },
    null,
    2
  ) + "\n"
);
if (args["--extension-dir"])
  fs.cpSync(
    path.join(root, "dist/extension"),
    path.resolve(args["--extension-dir"]),
    { recursive: true }
  );
console.log(
  "Native host registered. Reload the extension and refresh Overleaf."
);
