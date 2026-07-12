// Robust smooth-scroll to an element id, accounting for the sticky nav.
// Uses window.scrollTo (not element.scrollIntoView) because scrollIntoView
// can be a no-op in some browsers when the scrolling element is <html> and
// scroll-behavior is not set on the root.
export function scrollToId(id: string, offset = 64) {
  if (typeof window === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
  try {
    window.scrollTo({ top, behavior: "smooth" });
  } catch {
    window.scrollTo(0, top);
  }
}
