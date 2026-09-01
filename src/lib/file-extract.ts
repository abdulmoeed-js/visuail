// Client-side text extraction for uploaded files (PDF/DOCX).
// Nothing leaves the browser — all parsing happens in-page.

// These parsers are browser-only and must never enter the SSR/worker module
// graph — they are loaded lazily, on first use, inside the browser.
type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | undefined;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      }
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

async function loadMammoth() {
  // @ts-expect-error - no types for browser entry
  const mod = await import("mammoth/mammoth.browser");
  return (mod.default ?? mod) as {
    extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
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
  const pdfjsLib = await loadPdfjs();
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
  const mammoth = await loadMammoth();
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
