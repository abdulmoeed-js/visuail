// Combined "Export all to PDF" — snapshots one or more DOM nodes and
// stitches them into a single multi-page PDF. Runs entirely in the browser.

import html2canvas from "html2canvas";
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
    // Render at 2x for crisper output.
    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const img = canvas.toDataURL("image/png");
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 24;
    const ratio = Math.min(availW / canvas.width, availH / canvas.height);
    const drawW = canvas.width * ratio;
    const drawH = canvas.height * ratio;

    if (i > 0) pdf.addPage();
    pdf.setFontSize(14);
    pdf.setTextColor(20);
    pdf.text(title, margin, margin);
    pdf.setDrawColor(200);
    pdf.line(margin, margin + 6, pageW - margin, margin + 6);
    pdf.addImage(
      img, "PNG",
      margin + (availW - drawW) / 2,
      margin + 20,
      drawW,
      drawH,
    );
  }

  pdf.save(filename);
}
