import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { CANVAS_FULLSCREEN_EVENT } from "@/lib/canvas-events";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "visu — Your AI Business Analyst" },
      { name: "description", content: "Your AI Business Analyst. Turn a discovery call into a full, traced BA workstream — process maps, BMCs, RACI, risk logs, business cases, and more — grounded in real BA methodology and flagged the moment your source changes." },
      { name: "author", content: "visu" },
      { property: "og:title", content: "visu — Your AI Business Analyst" },
      { property: "og:description", content: "Your AI Business Analyst. Turn a discovery call into a full, traced BA workstream — process maps, BMCs, RACI, risk logs, business cases, and more — grounded in real BA methodology and flagged the moment your source changes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "visu — Your AI Business Analyst" },
      { name: "twitter:description", content: "Your AI Business Analyst. Turn a discovery call into a full, traced BA workstream — process maps, BMCs, RACI, risk logs, business cases, and more — grounded in real BA methodology and flagged the moment your source changes." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/90037d2d-c249-4433-98a2-32130cde459c/id-preview-4860b5b5--af93f212-53f2-471a-b865-406fc0935f89.lovable.app-1783892301019.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/90037d2d-c249-4433-98a2-32130cde459c/id-preview-4860b5b5--af93f212-53f2-471a-b865-406fc0935f89.lovable.app-1783892301019.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});


function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** The one place notices appear (currently: what an undo or redo changed).
 *
 *  A diagram canvas can take the browser's real fullscreen. The browser then
 *  draws that element and what is inside it, and nothing else, whatever its
 *  z-index -- so a toaster sitting at the root was invisible exactly where it
 *  mattered: in fullscreen the notice is the only sign that Ctrl/Cmd+Z did
 *  (or deliberately did not do) anything.
 *
 *  So the toaster lives in a container of its own, and that container is
 *  re-homed into whatever is fullscreen and back to <body> afterwards. The
 *  Toaster component itself stays mounted throughout, so a notice that is on
 *  screen at the moment of switching survives the move. One toaster rather
 *  than a second one inside the canvas: two would each show, and announce,
 *  every notice. Nothing is rendered on the server; there are no notices at
 *  first paint.
 *
 *  Top-centre, under the sticky nav: the canvases keep their own controls
 *  (legend, add bar, minimap) along the bottom edge, and a notice down there
 *  sat on the add field. In fullscreen it sits below the canvas toolbar row
 *  and the row of pinned lane headers an activity diagram keeps under it. */
function AppToaster() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [inFullscreen, setInFullscreen] = useState(false);
  useEffect(() => {
    const el = document.createElement("div");
    setContainer(el);
    const sync = () => {
      const host = document.fullscreenElement;
      const home = host ?? document.body;
      // Only when it actually has to move: re-inserting a node restarts the
      // animations inside it.
      if (el.parentElement !== home) home.appendChild(el);
      // Where the browser refuses real fullscreen (iPhone, an embedded
      // preview) the canvas fills the window by itself instead and marks
      // itself. The toaster can stay in <body> there -- it is drawn above --
      // but it needs the same lower position to clear the canvas's top rows.
      setInFullscreen(!!host || !!document.querySelector("[data-canvas-fs]"));
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener(CANVAS_FULLSCREEN_EVENT, sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener(CANVAS_FULLSCREEN_EVENT, sync);
      el.remove();
    };
  }, []);
  if (!container) return null;
  const top = inFullscreen ? 108 : 72;
  return createPortal(<Toaster position="top-center" offset={{ top }} mobileOffset={{ top }} />, container);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <AppToaster />
    </QueryClientProvider>
  );
}
