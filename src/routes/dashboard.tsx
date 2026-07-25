import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Nav } from "@/components/Nav";
import { useSession, sessionStore, FREE_LIMIT, type StoredProject, type Tier } from "@/lib/session";
import { allItems } from "@/data/samples";
import {
  FolderPlus, Workflow, LayoutGrid, ArrowUpRight, Trash2, ShieldCheck,
  Clock, Info, Loader2, LogIn, CheckCircle2, X, MoreHorizontal,
  Pencil, ExternalLink, AlertTriangle, LayoutTemplate,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckoutModal } from "@/components/CheckoutModal";
import { SignupWallModal } from "@/components/SignupWallModal";
import { cn } from "@/lib/utils";

type ActivationState = "idle" | "activating" | "done" | "timeout";

function useCheckoutActivation(currentTier: Tier): ActivationState {
  const [state, setState] = useState<ActivationState>("idle");
  const initialTierRef = useRef<Tier | null>(null);
  const tierRef = useRef(currentTier);
  tierRef.current = currentTier;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState(null, "", window.location.pathname);
    initialTierRef.current = currentTier;
    setState("activating");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== "activating") return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      if (initialTierRef.current !== null && tierRef.current !== initialTierRef.current) {
        clearInterval(id); setState("done"); return;
      }
      if (attempts >= 10) { clearInterval(id); setState("timeout"); return; }
      sessionStore.refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [state]);

  return state;
}

function ActivationBanner({ state, onDismiss }: { state: ActivationState; onDismiss: () => void }) {
  if (state === "idle") return null;
  return (
    <div
      className={cn(
        "mb-6 rounded-lg border p-3 flex items-center justify-between gap-3",
        state === "done" ? "bg-confident/10 border-confident/30" : "bg-card/60",
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        {state === "activating" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {state === "done" && <CheckCircle2 className="size-4 text-confident" />}
        {state === "timeout" && <Info className="size-4 text-muted-foreground" />}
        <span>
          {state === "activating" && "Payment received — activating your plan. This usually takes a few seconds."}
          {state === "done" && "Your plan is active."}
          {state === "timeout" && "Payment received — still finishing setup. Refresh in a minute if this doesn't update."}
        </span>
      </div>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Visuail" },
      { name: "description", content: "Your Visuail projects and quotas." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function fmtRel(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function projectStats(p: StoredProject) {
  let count = 0, unresolved = 0;
  for (const c of p.canvases) {
    const items = allItems(c.model);
    count += items.length;
    unresolved += items.filter(i => i.confidence < 0.7 || i.conflict).length;
  }
  return { count, unresolved };
}

function DashboardPage() {
  const s = useSession();
  const navigate = useNavigate();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const activation = useCheckoutActivation(s.tier);
  const [activationDismissed, setActivationDismissed] = useState(false);

  const quotaPct = s.tier === "free" ? Math.min(100, (s.projects.length / FREE_LIMIT) * 100) : 0;

  const startNew = () => {
    const check = sessionStore.canCreateProject(s.projects.length, s.tier);
    if (!check.ok) { setUpgradeOpen(true); return; }
    navigate({ to: "/new" });
  };

  const { continueProject, needsAttention, rest } = useMemo(() => {
    const sorted = [...s.projects].sort((a, b) => b.updatedAt - a.updatedAt);
    const cont = sorted[0];
    const others = sorted.slice(1);
    const attn: StoredProject[] = [];
    const remaining: StoredProject[] = [];
    for (const p of others) {
      const st = projectStats(p);
      if (st.unresolved > 0) attn.push(p); else remaining.push(p);
    }
    return { continueProject: cont, needsAttention: attn, rest: remaining };
  }, [s.projects]);

  if (s.loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="mx-auto max-w-[1200px] px-4 pt-24 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!s.signedIn) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="mx-auto max-w-[1200px] px-4 pt-24 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-card mb-4">
            <LogIn className="size-5 text-primary" />
          </div>
          <h1 className="font-display text-2xl">Sign in to see your projects.</h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            Projects are tied to your account, not this browser — they follow you across devices.
          </p>
          <Button className="mt-6" onClick={() => setSignInOpen(true)}>
            <LogIn className="size-4" /> Sign in
          </Button>
        </main>
        <SignupWallModal open={signInOpen} onOpenChange={setSignInOpen} action="Sign in" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="mx-auto max-w-[1200px] px-4 pt-8 pb-24">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 mb-8 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">
              Dashboard
            </div>
            <h1 className="font-display text-3xl md:text-4xl mt-1 truncate">Your workspace</h1>
            <p className="text-muted-foreground text-sm mt-1 truncate">
              Signed in as {s.email}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {s.tier === "free" && (
              <div className="hidden md:flex flex-col items-end gap-1 mr-1">
                <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
                  Free quota
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={quotaPct} className="w-32 h-1.5" />
                  <span className="text-[11px] font-mono-tight text-muted-foreground tabular-nums">
                    {s.projects.length}/{FREE_LIMIT}
                  </span>
                </div>
              </div>
            )}
            <TierPill tier={s.tier} onUpgrade={() => setUpgradeOpen(true)} />
            <Button onClick={startNew} className="h-10">
              <FolderPlus className="size-4" /> New project
            </Button>
          </div>
        </header>

        {!activationDismissed && (
          <ActivationBanner state={activation} onDismiss={() => setActivationDismissed(true)} />
        )}

        {s.projects.length === 0 ? (
          <EmptyState onStart={startNew} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* ── Primary column ─────────────────────────────── */}
            <div className="min-w-0 space-y-8">
              {continueProject && (
                <Section
                  eyebrow="Continue"
                  title="Where you left off"
                  hint={`Last edited ${fmtRel(continueProject.updatedAt)}`}
                >
                  <ContinueCard project={continueProject} />
                </Section>
              )}

              {needsAttention.length > 0 && (
                <Section
                  eyebrow="Needs attention"
                  title="Unresolved items"
                  hint={`${needsAttention.length} project${needsAttention.length === 1 ? "" : "s"} with low-confidence or conflicting items`}
                  tone="drift"
                >
                  <ProjectGrid projects={needsAttention} />
                </Section>
              )}

              {rest.length > 0 && (
                <Section
                  eyebrow="All projects"
                  title="Everything else"
                  hint={`${rest.length} project${rest.length === 1 ? "" : "s"}`}
                >
                  <ProjectGrid projects={rest} />
                </Section>
              )}
            </div>

            {/* ── Right rail ─────────────────────────────────── */}
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              {s.tier !== "free" && <PlanCard tier={s.tier} />}
              <TipsCard onNew={startNew} />
            </aside>
          </div>
        )}
      </main>

      <CheckoutModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        tier="Pro"
        price="$6/mo"
        unlocks={[
          "Unlimited projects and transcripts",
          "Drift detection & reconciliation",
          "Story → source traceability",
          "Version history per artifact",
        ]}
      />
    </div>
  );
}

/* ───────────────────────── Section wrapper ───────────────────────── */

function Section({
  eyebrow, title, hint, tone, children,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  tone?: "drift";
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "text-[10px] font-mono-tight uppercase tracking-widest",
              tone === "drift" ? "text-drift" : "text-primary",
            )}
          >
            {eyebrow}
          </div>
          <h2 className="font-display text-xl leading-tight truncate">{title}</h2>
        </div>
        {hint && (
          <span className="text-[11px] font-mono-tight text-muted-foreground shrink-0">
            {hint}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/* ───────────────────────── Continue card (large) ───────────────────────── */

function ContinueCard({ project }: { project: StoredProject }) {
  const st = projectStats(project);
  return (
    <Link
      to="/project/$id"
      params={{ id: project.id }}
      className="group relative block overflow-hidden rounded-2xl border bg-card p-5 transition hover:border-primary/50 hover:shadow-lg"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px 200px at 100% 0%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 60%)",
        }}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary mb-1.5">
            Pick up
          </div>
          <h3 className="font-display text-2xl leading-tight truncate">{project.name}</h3>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 max-w-2xl">
              {project.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <KindChips kinds={project.kinds} fromScratch={project.fromScratch} />
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-muted-foreground">
              <ShieldCheck className="size-3" /> {st.count} item{st.count === 1 ? "" : "s"}
            </span>
            {st.unresolved > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-drift">
                <AlertTriangle className="size-3" /> {st.unresolved} unresolved
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-muted-foreground">
              <Clock className="size-3" /> {fmtRel(project.updatedAt)}
            </span>
          </div>
        </div>
        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-2.5 py-1.5 text-sm font-medium text-foreground transition group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary">
          Open <ArrowUpRight className="size-4" />
        </div>
      </div>
    </Link>
  );
}

/* ───────────────────────── Grid + card ───────────────────────── */

function ProjectGrid({ projects }: { projects: StoredProject[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {projects.map(p => <ProjectCard key={p.id} project={p} />)}
    </div>
  );
}

function ProjectCard({ project }: { project: StoredProject }) {
  const st = projectStats(project);
  const navigate = useNavigate();

  const onRename = async () => {
    const next = window.prompt("Rename project", project.name);
    if (!next || next.trim() === "" || next.trim() === project.name) return;
    try {
      await sessionStore.updateProject(project.id, { name: next.trim() });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't rename this project.");
    }
  };

  const onDelete = async () => {
    if (!confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    try {
      await sessionStore.deleteProject(project.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't delete this project.");
    }
  };

  return (
    <div
      className="group relative rounded-xl border bg-card p-4 flex flex-col gap-3 transition hover:border-primary/50 hover:shadow-sm cursor-pointer"
      onClick={() => navigate({ to: "/project/$id", params: { id: project.id } })}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg leading-tight truncate">{project.name}</h3>
          {project.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{project.description}</p>
          )}
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="grid size-7 place-items-center rounded-md border bg-background/60 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition focus:opacity-100"
                aria-label="Project actions"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => navigate({ to: "/project/$id", params: { id: project.id } })}>
                <ExternalLink className="size-3.5" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <KindChips kinds={project.kinds} fromScratch={project.fromScratch} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="size-3" /> {st.count} item{st.count === 1 ? "" : "s"}
          {st.unresolved > 0 && (
            <span className="ml-1 text-drift">· {st.unresolved} unresolved</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {fmtRel(project.updatedAt)}
        </span>
      </div>
    </div>
  );
}

function KindChips({ kinds, fromScratch }: { kinds: StoredProject["kinds"]; fromScratch?: boolean }) {
  return (
    <>
      {kinds.includes("process") && (
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
          <Workflow className="size-3" /> Process map
        </span>
      )}
      {kinds.includes("bmc") && (
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
          <LayoutGrid className="size-3" /> BMC
        </span>
      )}
      {fromScratch && (
        <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] font-mono-tight text-muted-foreground">
          empty
        </span>
      )}
    </>
  );
}

/* ───────────────────────── Right rail ───────────────────────── */

function PlanCard({ tier }: { tier: Tier }) {
  const label = tier === "pro" ? "Pro" : "Team";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary mb-1">
        {label} plan
      </div>
      <h3 className="font-display text-lg leading-tight">All features unlocked.</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Unlimited projects, drift detection, version history, and source traceability are on.
      </p>
    </div>
  );
}

function TipsCard({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground mb-1">
        Try next
      </div>
      <ul className="space-y-2 text-sm">
        <li>
          <button onClick={onNew} className="w-full text-left flex items-center gap-2 hover:text-primary transition">
            <LayoutTemplate className="size-3.5 shrink-0 text-muted-foreground" />
            <span>Start from a template</span>
          </button>
        </li>
        <li>
          <button onClick={onNew} className="w-full text-left flex items-center gap-2 hover:text-primary transition">
            <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
            <span>Paste a transcript</span>
          </button>
        </li>
        <li>
          <Link to="/" className="w-full text-left flex items-center gap-2 hover:text-primary transition">
            <Info className="size-3.5 shrink-0 text-muted-foreground" />
            <span>See what Visuail does</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

/* ───────────────────────── Bits ───────────────────────── */

function TierPill({ tier, onUpgrade }: { tier: Tier; onUpgrade: () => void }) {
  const label = tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Team";
  return (
    <button
      onClick={tier === "free" ? onUpgrade : undefined}
      className={cn(
        "h-8 rounded-full border px-3 text-[11px] font-mono-tight uppercase tracking-widest transition",
        tier === "free"
          ? "border-dashed border-primary/40 text-primary hover:bg-primary/5 cursor-pointer"
          : "bg-primary/10 border-primary/40 text-primary cursor-default",
      )}
      title={tier === "free" ? "Upgrade" : `Current plan: ${label}`}
    >
      {label} plan
    </button>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/60 p-12 text-center bp-grid-fine">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-card mb-4">
        <FolderPlus className="size-5 text-primary" />
      </div>
      <h2 className="font-display text-2xl">Nothing here yet.</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
        Start a project from a transcript, a template, or a blank canvas. You don't need a source to begin —
        you can paste one anytime later.
      </p>
      <Button onClick={onStart} className="mt-6"><FolderPlus className="size-4" /> New project</Button>
    </div>
  );
}
