// Export a canvas DOM node to PDF, PNG, or SVG. Runs entirely in the
// browser. Uses html-to-image (svg foreignObject) because html2canvas
// can't parse modern CSS color functions like oklch().

import type { jsPDF as Pdf } from "jspdf";
import {
  SEGMENT_LABEL, SEGMENT_ORDER, SEGMENT_TONE, TONE_HEX, summaryWords,
  type GradeSummary, type GradeTone, type Segment,
} from "@/lib/grade";

// Browser-only libraries: loaded lazily so they never enter the SSR/worker
// module graph (jspdf/html-to-image touch DOM globals at import time). The
// type import above is erased at build time, so it loads nothing.
const loadHtmlToImage = () => import("html-to-image");
const loadJsPdf = async () => (await import("jspdf")).default;


export interface ExportSection {
  title: string;
  /** Return the element to snapshot. Called just before capture so callers
   *  can bring hidden panes into view and wait for layout/paint first. */
  getElement: () => Promise<HTMLElement | null> | HTMLElement | null;
  /** How sure the items in this section are. When given, the page carries
   *  the counts in words and a coloured bar under the title, and a legend
   *  for the colours, because a printed page has no tooltips or legend. */
  summary?: GradeSummary;
}

/** Height the grade bar and its words take under the title. */
const SUMMARY_HEIGHT = 24;
const BAR_WIDTH = 280;
const BAR_HEIGHT = 4;
const BAR_GAP = 2;
const TRACK_HEX = "#E5E5EA";
const WORDS_HEX = "#3C3C43";

/** jsPDF has no opacity for fills, so a lighter shade is mixed with white
 *  (the bar on screen draws "stated clearly" at 70% to set it apart from
 *  "confirmed", which shares its colour). */
function mixWithWhite(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    return Math.round(v * amount + 255 * (1 - amount)).toString(16).padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Matches the on-screen bar's opacity for "stated clearly"; a shade, not a
 *  certainty threshold. */
const CLEAR_SHADE = 0.7;

function segmentHex(k: Segment): string {
  const fill = TONE_HEX[SEGMENT_TONE[k]].fill;
  return k === "clear" ? mixWithWhite(fill, CLEAR_SHADE) : fill;
}

/** The bar (one segment per non-empty grade, sized by count) and, under it,
 *  the same counts in words. `top` is the top edge of the bar. */
function drawSummary(pdf: Pdf, summary: GradeSummary, x: number, top: number, maxWidth: number) {
  const width = Math.min(BAR_WIDTH, maxWidth);
  pdf.setFillColor(TRACK_HEX);
  pdf.rect(x, top, width, BAR_HEIGHT, "F");
  const segments = SEGMENT_ORDER.filter((k) => summary[k] > 0);
  if (summary.total > 0 && segments.length > 0) {
    const usable = width - BAR_GAP * (segments.length - 1);
    let cursor = x;
    for (const k of segments) {
      const w = (usable * summary[k]) / summary.total;
      pdf.setFillColor(segmentHex(k));
      pdf.rect(cursor, top, w, BAR_HEIGHT, "F");
      cursor += w + BAR_GAP;
    }
  }
  pdf.setFontSize(9);
  pdf.setTextColor(WORDS_HEX);
  pdf.text(summaryWords(summary), x, top + BAR_HEIGHT + 12);
}

/** One line at the foot of the page naming each colour, grouped the way the
 *  bar colours them: "Confirmed or stated clearly", "Unclear", ... */
function drawLegend(pdf: Pdf, x: number, baseline: number) {
  const groups: { tone: GradeTone; labels: string[] }[] = [];
  for (const k of SEGMENT_ORDER) {
    const tone = SEGMENT_TONE[k];
    const group = groups.find((g) => g.tone === tone);
    if (group) group.labels.push(SEGMENT_LABEL[k]);
    else groups.push({ tone, labels: [SEGMENT_LABEL[k]] });
  }
  pdf.setFontSize(8);
  pdf.setTextColor(WORDS_HEX);
  const swatch = 6;
  let cursor = x;
  for (const g of groups) {
    const text = g.labels.join(" or ");
    const label = text.charAt(0).toUpperCase() + text.slice(1);
    pdf.setFillColor(TONE_HEX[g.tone].fill);
    pdf.rect(cursor, baseline - swatch, swatch, swatch, "F");
    cursor += swatch + 4;
    pdf.text(label, cursor, baseline);
    cursor += pdf.getTextWidth(label) + 14;
  }
}

/** Neutralizes a canvas's pan/zoom transform for the duration of `fn`, so
 *  export always captures the natural, untransformed layout regardless of
 *  the viewer's current pan/zoom position. Shared by every export format. */
async function withNeutralizedTransform<T>(
  el: HTMLElement,
  fn: (inner: HTMLElement, width: number, height: number) => Promise<T>,
): Promise<T> {
  const inner = el.querySelector<HTMLElement>("[data-canvas-content]") ?? el;
  const prevTransform = inner.style.transform;
  const prevTransition = inner.style.transition;
  const prevVisibility = inner.style.visibility;
  inner.style.transition = "none";
  inner.style.transform = "none";
  // The canvas keeps its content hidden until it has been laid out once. A
  // pane shown only for this snapshot may be caught before that; the picture
  // must not come out blank because of it.
  inner.style.visibility = "visible";
  // Anything a view keeps pinned to the visible canvas (activity lane
  // headers follow the camera) is offset by the current pan. In the picture
  // the camera is gone, so those go back to where they belong in the layout.
  const pinned = Array.from(inner.querySelectorAll<HTMLElement>("[data-canvas-pinned]"));
  const prevPinned = pinned.map((p) => p.style.transform);
  pinned.forEach((p) => { p.style.transform = "none"; });
  const width = inner.offsetWidth;
  const height = inner.offsetHeight;
  try {
    return await fn(inner, width, height);
  } finally {
    // Put back only what is still ours. The capture is slow, and a pane shown
    // just for it gets laid out meanwhile: React then writes the real camera
    // and makes the content visible. Writing the values saved BEFORE that
    // back over React's would leave the diagram hidden, at the placeholder
    // camera, until the canvas next remounts -- React only writes a style
    // when its own value changes, so it would never correct it.
    if (inner.style.transform === "none") inner.style.transform = prevTransform;
    if (inner.style.visibility === "visible") inner.style.visibility = prevVisibility;
    // Same test for the transition: two exports of one canvas can overlap
    // (nothing disables the buttons), and the second would otherwise save
    // the first one's "none" and write it back for good.
    if (inner.style.transition === "none") inner.style.transition = prevTransition;
    pinned.forEach((p, i) => { if (p.style.transform === "none") p.style.transform = prevPinned[i]; });
  }
}

async function snapshot(el: HTMLElement): Promise<{ dataUrl: string; w: number; h: number }> {
  const { toPng } = await loadHtmlToImage();
  const dataUrl = await withNeutralizedTransform(el, (inner, width, height) =>
    toPng(inner, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      width,
      height,
      style: { transform: "none", transformOrigin: "top left", left: "0", top: "0" },
    }),
  );

  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("failed to load rendered snapshot"));
  });
  return { dataUrl, w: img.width, h: img.height };
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

/** Downloads a single canvas as a PNG. */
export async function exportElementToPng(filename: string, el: HTMLElement): Promise<void> {
  const { dataUrl } = await snapshot(el);
  downloadDataUrl(filename, dataUrl);
}

/** Downloads a single canvas as an SVG (vector, not rasterized). */
export async function exportElementToSvg(filename: string, el: HTMLElement): Promise<void> {
  const { toSvg } = await loadHtmlToImage();
  const dataUrl = await withNeutralizedTransform(el, (inner, width, height) =>
    toSvg(inner, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      width,
      height,
      style: { transform: "none", transformOrigin: "top left", left: "0", top: "0" },
    }),
  );
  downloadDataUrl(filename, dataUrl);
}

export async function exportSectionsToPdf(
  filename: string,
  sections: ExportSection[],
): Promise<void> {
  if (sections.length === 0) return;
  const jsPDF = await loadJsPdf();
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 32;

  let pageIndex = 0;
  for (const s of sections) {
    const el = await s.getElement();
    if (!el) continue;
    const shot = await snapshot(el);

    // With a summary, the picture moves down to make room for the bar and
    // its words; the legend sits in the bottom margin, below the picture.
    const summaryH = s.summary ? SUMMARY_HEIGHT : 0;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 24 - summaryH;
    const ratio = Math.min(availW / shot.w, availH / shot.h);
    const drawW = shot.w * ratio;
    const drawH = shot.h * ratio;

    if (pageIndex > 0) pdf.addPage();
    pdf.setFontSize(14);
    pdf.setTextColor(20);
    pdf.text(s.title, margin, margin);
    pdf.setDrawColor(200);
    pdf.line(margin, margin + 6, pageW - margin, margin + 6);
    if (s.summary) {
      drawSummary(pdf, s.summary, margin, margin + 14, availW);
      if (s.summary.total > 0) drawLegend(pdf, margin, pageH - margin / 2);
    }
    pdf.addImage(
      shot.dataUrl, "PNG",
      margin + (availW - drawW) / 2,
      margin + 20 + summaryH,
      drawW,
      drawH,
    );
    pageIndex++;
  }

  pdf.save(filename);
}
