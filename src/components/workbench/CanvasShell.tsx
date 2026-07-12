import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, ZoomIn, ZoomOut, LocateFixed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CanvasState {
  zoom: number;
  pan: { x: number; y: number };
}
const CanvasCtx = createContext<CanvasState>({ zoom: 1, pan: { x: 0, y: 0 } });
export const useCanvas = () => useContext(CanvasCtx);

interface Props {
  contentWidth: number;
  contentHeight: number;
  children: ReactNode;
  toolbar?: ReactNode;              // extra buttons rendered top-left
  bottomLeft?: ReactNode;           // legend etc.
  bottomRight?: ReactNode;          // e.g. Add step
  minimap?: boolean;
  gridClassName?: string;
  minZoom?: number;
  maxZoom?: number;
  fullscreenLabel?: string;
}

export function CanvasShell({
  contentWidth, contentHeight, children,
  toolbar, bottomLeft, bottomRight, minimap,
  gridClassName = "bp-grid",
  minZoom = 0.2, maxZoom = 3,
  fullscreenLabel = "Fullscreen canvas",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [fs, setFs] = useState(false);

  const fitView = () => {
    const el = viewportRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const z = Math.min(1, Math.min((width - 80) / contentWidth, (height - 80) / contentHeight));
    setZoom(z);
    setPan({ x: Math.max(20, (width - contentWidth * z) / 2), y: 30 });
  };

  // Native browser Fullscreen API — with CSS fallback for browsers/contexts
  // that reject requestFullscreen (iframes without the allow attribute, etc.).
  const toggleFs = async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        setFs((v) => !v);
      }
    } catch {
      setFs((v) => !v);
    }
  };

  useEffect(() => {
    const onFsChange = () => setFs(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "0" || e.code === "Digit0")) {
        e.preventDefault(); fitView();
      }
      if (e.key === "Escape" && fs && !document.fullscreenElement) setFs(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, contentWidth, contentHeight]);



  // Non-passive wheel listener — needed so ctrl/pinch-zoom can call preventDefault
  // (React's synthetic onWheel is passive by default and would let the browser
  // page-zoom instead of zooming our canvas).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const vp = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const px = e.clientX - vp.left, py = e.clientY - vp.top;
        const factor = Math.exp(-e.deltaY * 0.0018);
        setZoom((z) => {
          const nz = Math.min(maxZoom, Math.max(minZoom, z * factor));
          setPan((p) => ({ x: px - (px - p.x) * (nz / z), y: py - (py - p.y) * (nz / z) }));
          return nz;
        });
      } else {
        e.preventDefault();
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minZoom, maxZoom]);

  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-node]") || t.closest("[data-no-pan]")) return;
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: pan.x, y: pan.y, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.x + (e.clientX - dragRef.current.startX),
      y: dragRef.current.y + (e.clientY - dragRef.current.startY),
    });
  };
  const stopPan = () => { dragRef.current = null; };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-lg border",
        gridClassName,
        fs && "fixed inset-0 z-[70] rounded-none border-0 h-screen w-screen bg-background",
      )}
      role={fs ? "dialog" : undefined}
      aria-label={fs ? fullscreenLabel : undefined}
    >

      {/* Zoom toolbar */}
      <div className="absolute top-3 right-3 z-30 flex gap-1 rounded-md border bg-card/95 backdrop-blur p-1 shadow-sm" data-no-pan>
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => setZoom((z) => Math.max(minZoom, +(z - 0.1).toFixed(2)))} title="Zoom out">
          <ZoomOut className="size-3.5" />
        </Button>
        <button
          onClick={() => { setZoom(1); }}
          title="Reset zoom (Ctrl/Cmd+0 fits view)"
          className="w-12 text-center text-[11px] font-mono-tight text-muted-foreground hover:text-foreground self-center"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => setZoom((z) => Math.min(maxZoom, +(z + 0.1).toFixed(2)))} title="Zoom in">
          <ZoomIn className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={fitView} title="Fit to view (Ctrl/Cmd+0)">
          <LocateFixed className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={toggleFs}
          title={fs ? "Exit fullscreen (Esc)" : "Fullscreen"}>
          {fs ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>


      {toolbar && (
        <div className="absolute top-3 left-3 z-30 flex gap-1" data-no-pan>{toolbar}</div>
      )}

      {fs && (
        <>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-full border bg-card/95 backdrop-blur px-3 py-1 text-[11px] font-mono-tight text-muted-foreground" data-no-pan>
            Fullscreen · press <kbd className="px-1 rounded bg-muted mx-0.5">Esc</kbd> to exit
          </div>
          <Button
            size="icon" variant="outline"
            className="absolute top-3 right-[220px] z-30 h-8 w-8 bg-card/95 backdrop-blur"
            onClick={() => setFs(false)}
            title="Close fullscreen"
            data-no-pan
          >
            <X className="size-4" />
          </Button>
        </>
      )}

      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        <CanvasCtx.Provider value={{ zoom, pan }}>
          <div
            className="absolute origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              width: contentWidth,
              height: contentHeight,
            }}
          >
            {children}
          </div>
        </CanvasCtx.Provider>
      </div>

      {bottomLeft && <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2" data-no-pan>{bottomLeft}</div>}
      {bottomRight && <div className="absolute bottom-3 right-3 z-20" data-no-pan>{bottomRight}</div>}

      {minimap && (
        <Minimap contentW={contentWidth} contentH={contentHeight}
          pan={pan} zoom={zoom} viewportRef={viewportRef}
          onJump={(cx, cy) => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            setPan({ x: r.width / 2 - cx * zoom, y: r.height / 2 - cy * zoom });
          }}
        />
      )}
    </div>
  );
}

function Minimap({
  contentW, contentH, pan, zoom, viewportRef, onJump,
}: {
  contentW: number; contentH: number;
  pan: { x: number; y: number }; zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onJump: (cx: number, cy: number) => void;
}) {
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setVp({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);
  const MAX = 150;
  const scale = MAX / Math.max(contentW, contentH);
  const mw = contentW * scale, mh = contentH * scale;
  const vw = Math.min(mw, (vp.w / zoom) * scale);
  const vh = Math.min(mh, (vp.h / zoom) * scale);
  const vx = Math.max(0, Math.min(mw - vw, (-pan.x / zoom) * scale));
  const vy = Math.max(0, Math.min(mh - vh, (-pan.y / zoom) * scale));
  return (
    <div className="absolute bottom-3 right-3 z-30 rounded-md border bg-card/95 backdrop-blur p-1.5 shadow-sm" data-no-pan>
      <div
        className="relative bg-muted/50 rounded-sm cursor-pointer overflow-hidden"
        style={{ width: mw, height: mh }}
        onPointerDown={(e) => {
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          onJump((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        }}
      >
        <div
          className="absolute border-2 border-primary/70 bg-primary/10 rounded-sm pointer-events-none"
          style={{ left: vx, top: vy, width: vw, height: vh }}
        />
      </div>
    </div>
  );
}
