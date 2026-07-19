import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Moon, Sun, LayoutDashboard, LogOut, Building2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToId } from "@/lib/scroll";
import { sessionStore, useSession, type Session } from "@/lib/session";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function OrgSwitcher({ session }: { session: Session }) {
  // Only a decision worth surfacing once there's more than one workspace to pick from.
  if (session.orgs.length < 2) return null;
  const current = session.orgs.find((o) => o.id === session.currentOrgId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 px-2.5 rounded-md border text-sm inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition max-w-[160px]">
          <Building2 className="size-3.5 shrink-0" />
          <span className="truncate">{current?.name ?? "Workspace"}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session.orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => session.switchOrg(o.id)} className="justify-between">
            <span className="truncate">{o.name}</span>
            {o.id === session.currentOrgId && <Check className="size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Nav() {
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const session = useSession();
  const onDashboard = router.state.location.pathname.startsWith("/dashboard");
  const onHome = router.state.location.pathname === "/";

  useEffect(() => {
    const el = document.documentElement;
    if (dark) el.classList.add("dark"); else el.classList.remove("dark");
  }, [dark]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    if (!onHome) {
      router.navigate({ to: "/", hash: id });
      return;
    }
    scrollToId(id);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full backdrop-blur transition-all",
        scrolled || !onHome ? "bg-background/85 border-b" : "bg-transparent",
      )}
    >
      <div className="mx-auto max-w-[1400px] px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Logo />
          <span className="font-display text-xl tracking-tight">Visuail</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <button onClick={() => scrollTo("workbench")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">Workbench</button>
          <button onClick={() => scrollTo("why-not-miro")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">The maintenance problem</button>
          <button onClick={() => scrollTo("pricing")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">Pricing</button>
          {session.signedIn && !onDashboard && (
            <Link to="/dashboard" className="px-3 py-1.5 rounded-md hover:bg-muted transition inline-flex items-center gap-1.5">
              <LayoutDashboard className="size-3.5" /> Dashboard
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {session.signedIn && <OrgSwitcher session={session} />}
          <button
            onClick={() => setDark((d) => !d)}
            className="h-8 w-8 rounded-md border grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {session.signedIn ? (
            <>
              <Link
                to="/dashboard"
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition inline-flex items-center gap-1.5"
              >
                <LayoutDashboard className="size-3.5" /> Dashboard
              </Link>
              <button
                onClick={() => { sessionStore.signOut(); router.navigate({ to: "/" }); }}
                className="h-8 w-8 rounded-md border grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
                aria-label="Sign out" title={`Sign out (${session.email})`}
              >
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Link
              to="/dashboard"
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition"
            >
              Try the workbench
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 48 48" className="text-primary">
      <path d="M9 9 L24 37 L39 9" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="4" fill="currentColor" />
      <circle cx="39" cy="9" r="4" className="fill-unresolved" />
      <circle cx="24" cy="37" r="5.2" fill="currentColor" />
    </svg>
  );
}
