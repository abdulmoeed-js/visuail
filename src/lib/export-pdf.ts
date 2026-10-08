// Export a canvas DOM node to PDF, PNG, or SVG. Runs entirely in the
// browser. Uses html-to-image (svg foreignObject) because html2canvas
// can't parse modern CSS color functions like oklch().

// Browser-only libraries: loaded lazily so they never enter the SSR/worker
// module graph (jspdf/html-to-image touch DOM globals at import time).
const loadHtmlToImage = () => import("html-to-image");
const loadJsPdf = async () => (await import("jspdf")).default;


export interface ExportSection {
  title: string;
  /** Return the element to snapshot. Called just before capture so callers
   *  can bring hidden panes into view and wait for layout/paint first. */
  getElement: () => Promise<HTMLElement | null> | HTMLElement | null;
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
    inner.style.transition = prevTransition;
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
