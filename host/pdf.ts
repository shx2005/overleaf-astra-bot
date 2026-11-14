import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const exec = promisify(execFile);
export async function downloadPdf(
  dir: string,
  call: (method: string, args: object) => Promise<any>
) {
  const meta = await call("compile_pdf", {});
  if (
    !Number.isSafeInteger(meta.size) ||
    meta.size < 5 ||
    meta.size > 100 * 1024 * 1024
  )
    throw new Error("PDF size is invalid or exceeds 100 MiB");
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < meta.size; ) {
    const part = await call("pdf_chunk", { pdfId: meta.pdfId, offset });
    const b = Buffer.from(part.base64, "base64");
    if (!b.length || b.length > 262144 || offset + b.length > meta.size)
      throw new Error("Invalid PDF chunk");
    chunks.push(b);
    offset += b.length;
  }
  const pdf = Buffer.concat(chunks);
  if (pdf.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("Downloaded output is not a PDF");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const target = path.join(dir, "pdf", sha256);
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const pdfPath = path.join(target, "paper.pdf");
  await fs.writeFile(pdfPath, pdf, { mode: 0o600 });
  return { pdfPath, target, sha256, compiledAt: meta.compiledAt as string };
}
export async function preparePdf(pdfPath: string, target: string) {
  const document = await getDocument({
    data: new Uint8Array(await fs.readFile(pdfPath)),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages: Array<{ page: number; image: string }> = [];
  try {
    for (let i = 1; i <= document.numPages; i++) {
      pages.push({ page: i, image: path.join(target, `page-${i}.jpg`) });
    }
  } finally {
    await document.destroy();
  }
  const renderer = process.env.AGEAF_PDFTOPPM ?? "pdftoppm";
  // Render all pages, with bounded per-page resolution. Never silently omit pages.
  for (const page of pages) {
    await exec(
      renderer,
      [
        "-f",
        String(page.page),
        "-l",
        String(page.page),
        "-singlefile",
        "-jpeg",
        "-r",
        "130",
        "-scale-to",
        "1800",
        pdfPath,
        path.join(target, `page-${page.page}`),
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 }
    );
  }
  return pages;
}
