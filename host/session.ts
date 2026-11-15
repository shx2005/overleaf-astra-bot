import type { ContextUsage } from "../extension/context-usage.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export type ProjectState = {
  version: 1;
  projectId: string;
  threadId: string;
  pdf?: {
    sha256: string;
    pages: number;
    completedPages: number;
    compiledAt: string;
  };
  reviewEventIds?: string[];
  reviewHistory?: import("../extension/reviews.js").ReviewEvent[];
  contextUsage?: ContextUsage;
  updatedAt: string;
};
export function projectDirectory(
  projectId: string,
  root = process.env.OVERLEAF_BOT_STATE_DIR ??
    path.join(os.homedir(), ".overleaf-astra-bot")
) {
  if (!/^[a-f0-9]{24}$/i.test(projectId))
    throw new Error("Invalid Overleaf project ID");
  const dir = path.join(root, "projects", projectId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function readState(dir: string): ProjectState | null {
  const p = path.join(dir, "session.json");
  if (!fs.existsSync(p)) return null;
  const s = JSON.parse(fs.readFileSync(p, "utf8")) as ProjectState;
  if (s.version !== 1 || typeof s.threadId !== "string" || !s.threadId)
    throw new Error(
      "Invalid saved session; refusing to silently discard history"
    );
  return s;
}
export function saveState(dir: string, state: ProjectState) {
  const p = path.join(dir, "session.json"),
    tmp = p + `.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) +
      "\n",
    { mode: 0o600 }
  );
  fs.renameSync(tmp, p);
}
export function lockProject(dir: string): () => void {
  const file = path.join(dir, "session.lock");
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          if (fs.readFileSync(file, "utf8") === String(process.pid))
            fs.unlinkSync(file);
        } catch {}
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(fs.readFileSync(file, "utf8"));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (alive)
        throw new Error("此项目的 bot 正在处理另一条指令，请完成后再试。");
      fs.unlinkSync(file);
    }
  }
  throw new Error("Cannot lock project session");
}
