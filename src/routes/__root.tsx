import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

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
      { title: "Visuail — Diagrams that know when they're stale" },
      { name: "description", content: "A semantic artifact engine for business analysts and PMs. Turn discovery calls into typed, confidence-scored artifacts — process maps, BMCs, BRDs, and backlogs that flag themselves when the source of truth drifts." },
      { name: "author", content: "Visuail" },
      { property: "og:title", content: "Visuail — Diagrams that know when they're stale" },
      { property: "og:description", content: "A semantic artifact engine for business analysts and PMs. Turn discovery calls into typed, confidence-scored artifacts — process maps, BMCs, BRDs, and backlogs that flag themselves when the source of truth drifts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Visuail — Diagrams that know when they're stale" },
      { name: "twitter:description", content: "A semantic artifact engine for business analysts and PMs. Turn discovery calls into typed, confidence-scored artifacts — process maps, BMCs, BRDs, and backlogs that flag themselves when the source of truth drifts." },
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // TEMPORARY — connectivity smoke test for the Supabase integration.
  // Remove once real auth (src/lib/session.ts) is wired in; that will be
  // the permanent, real verification that the connection works.
  useEffect(() => {
    import("@/integrations/supabase/client").then(({ supabase }) => {
      // Exposed only for this temporary diagnostic — remove alongside it.
      (window as unknown as Record<string, unknown>).__supabaseDebug = supabase;
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .then(({ error, status, statusText, count }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error(
              "[supabase smoke test] FAILED status=" +
                status +
                " statusText=" +
                statusText +
                " code=" +
                error.code +
                " message=" +
                error.message +
                " details=" +
                error.details +
                " hint=" +
                error.hint,
            );
          } else {
            // eslint-disable-next-line no-console
            console.log(
              "[supabase smoke test] OK status=" + status + " count=" + count,
            );
          }
        });
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
