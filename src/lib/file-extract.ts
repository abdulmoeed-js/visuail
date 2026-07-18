// Client-side text extraction for uploaded files (PDF/DOCX).
// Nothing leaves the browser — all parsing happens in-page.

import * as pdfjsLib from "pdfjs-dist";
// Vite serves the worker as a URL asset. Modern pdfjs-dist ships an ESM worker.
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// Browser build of mammoth — do not import the Node build.
// (No official types shipped for the browser entry; declare below.)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - no types for browser entry
import mammoth from "mammoth/mammoth.browser";

// Register worker exactly once.
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export type UploadKind = "pdf" | "docx" | "unsupported";

export function detectKind(file: File): UploadKind {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    n.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  return "unsupported";
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: unknown) => (it as { str?: string }).str ?? "")
      .join(" ");
    chunks.push(text);
  }
  return chunks.join("\n\n").replace(/[ \t]+/g, " ").trim();
}

export async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return (result.value as string).trim();
}

export async function extractFileText(file: File): Promise<string> {
  const kind = detectKind(file);
  if (kind === "pdf") return extractPdfText(file);
  if (kind === "docx") return extractDocxText(file);
  throw new Error("Unsupported file type. Please upload a .pdf or .docx.");
}
