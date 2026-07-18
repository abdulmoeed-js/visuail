// Combined "Export all to PDF" — snapshots one or more DOM nodes and
// stitches them into a single multi-page PDF. Runs entirely in the browser.
// Uses html-to-image (svg foreignObject) because html2canvas can't parse
// modern CSS color functions like oklch().

import { toPng } from "html-to-image";
import jsPDF from "jspdf";

export interface ExportSection {
  title: string;
  element: HTMLElement;
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

  for (let i = 0; i < sections.length; i++) {
    const { title, element } = sections[i];
    const rect = element.getBoundingClientRect();
    const dataUrl = await toPng(element, {
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

    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 24;
    const ratio = Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;

    if (i > 0) pdf.addPage();
    pdf.setFontSize(14);
    pdf.setTextColor(20);
    pdf.text(title, margin, margin);
    pdf.setDrawColor(200);
    pdf.line(margin, margin + 6, pageW - margin, margin + 6);
    pdf.addImage(
      dataUrl, "PNG",
      margin + (availW - drawW) / 2,
      margin + 20,
      drawW,
      drawH,
    );
  }

  pdf.save(filename);
}
