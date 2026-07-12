import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToId } from "@/lib/scroll";

export function Nav() {
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    if (dark) el.classList.add("dark"); else el.classList.remove("dark");
  }, [dark]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => scrollToId(id);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full backdrop-blur transition-all",
        scrolled ? "bg-background/85 border-b" : "bg-transparent",
      )}
    >
      <div className="mx-auto max-w-[1400px] px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Logo />
          <span className="font-display text-xl tracking-tight">Visuail</span>
          <span className="ml-1 rounded-sm bg-primary/10 text-primary text-[9px] font-mono-tight px-1.5 py-0.5">
            v0.1 · demo
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <button onClick={() => scrollTo("product")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">Product</button>
          <button onClick={() => scrollTo("why-not-miro")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">Why not Miro</button>
          <button onClick={() => scrollTo("pricing")} className="px-3 py-1.5 rounded-md hover:bg-muted transition">Pricing</button>
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDark((d) => !d)}
            className="h-8 w-8 rounded-md border grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            onClick={() => scrollTo("workbench")}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition"
          >
            Try the workbench
          </button>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="text-primary">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 8 L10 14 L14 10 L18 16" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="8" r="1.4" fill="currentColor" />
      <circle cx="18" cy="16" r="1.4" fill="currentColor" />
    </svg>
  );
}
