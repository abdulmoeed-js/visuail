// Combined "Export all to PDF" — snapshots one or more DOM nodes and
// stitches them into a single multi-page PDF. Runs entirely in the browser.
// Uses html-to-image (svg foreignObject) because html2canvas can't parse
// modern CSS color functions like oklch().

import { toPng } from "html-to-image";
import jsPDF from "jspdf";

export interface ExportSection {
  title: string;
  /** Return the element to snapshot. Called just before capture so callers
   *  can bring hidden panes into view and wait for layout/paint first. */
  getElement: () => Promise<HTMLElement | null> | HTMLElement | null;
}

async function snapshot(el: HTMLElement): Promise<{ dataUrl: string; w: number; h: number }> {
  const rect = el.getBoundingClientRect();
  const dataUrl = await toPng(el, {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
    width: rect.width,
    height: rect.height,
  });
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("failed to load rendered snapshot"));
  });
  return { dataUrl, w: img.width, h: img.height };
}

export async function exportSectionsToPdf(
  filename: string,
  sections: ExportSection[],
): Promise<void> {
  if (sections.length === 0) return;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 32;

  let pageIndex = 0;
  for (const s of sections) {
    const el = await s.getElement();
    if (!el) continue;
    const shot = await snapshot(el);

    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 24;
    const ratio = Math.min(availW / shot.w, availH / shot.h);
    const drawW = shot.w * ratio;
    const drawH = shot.h * ratio;

    if (pageIndex > 0) pdf.addPage();
    pdf.setFontSize(14);
    pdf.setTextColor(20);
    pdf.text(s.title, margin, margin);
    pdf.setDrawColor(200);
    pdf.line(margin, margin + 6, pageW - margin, margin + 6);
    pdf.addImage(
      shot.dataUrl, "PNG",
      margin + (availW - drawW) / 2,
      margin + 20,
      drawW,
      drawH,
    );
    pageIndex++;
  }

  pdf.save(filename);
}
