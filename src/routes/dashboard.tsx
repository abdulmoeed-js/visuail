import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { Nav } from "@/components/Nav";
import { useSession, sessionStore, FREE_LIMIT, type StoredProject, type Tier, type DriftAlert, type ViewKind } from "@/lib/session";
import { allItems } from "@/data/samples";
import { addSummaries, summarizeGrades } from "@/lib/grade";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";
import {
  FolderPlus, Workflow, LayoutGrid, ArrowUpRight, Trash2, Layers,
  Clock, Info, Loader2, LogIn, CheckCircle2, X, MoreHorizontal,
  Pencil, ExternalLink, AlertTriangle, LayoutTemplate, MessageSquare,
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
        {state === "done" && <CheckCircle2 className="size-4 text-confident-ink" />}
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

/* ───────────────────────── Needs review (drift) ───────────────────────── */

function driftItemCount(a: DriftAlert): number {
  return a.summary.reduce((n, s) => n + s.changed.length + s.added.length + s.removed.length, 0);
}

/** Dashboard-wide surface for the scheduled background drift scan -- the
 *  product's actual differentiator ("diagrams that know when they're
 *  stale"), so it leads the page instead of being buried inside each
 *  project. Detection only: clicking through lands on the existing
 *  per-project drift banner, which is where reconciling into the canvas
 *  actually happens -- this never touches a canvas itself. */
function NeedsReviewStrip({ projects }: { projects: StoredProject[] }) {
  const [alerts, setAlerts] = useState<(DriftAlert & { projectId: string })[] | null>(null);

  useEffect(() => {
    sessionStore.listRecentDriftAlertsForProjects(projects.map((p) => p.id))
      .then(setAlerts)
      .catch(() => setAlerts([]));
    // Re-fetch when the actual set of projects changes, not on every
    // session refetch that leaves the id set identical.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).sort().join(",")]);

  if (!alerts || alerts.length === 0) return null;

  // Multiple accumulated alerts can exist per project (one per scan day);
  // show one entry per project, keyed to its most recent detection.
  const byProject = new Map<string, DriftAlert & { projectId: string }>();
  for (const a of alerts) {
    const existing = byProject.get(a.projectId);
    if (!existing || a.detectedAt > existing.detectedAt) byProject.set(a.projectId, a);
  }
  const entries = [...byProject.values()].sort((a, b) => b.detectedAt - a.detectedAt);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-drift/30 bg-gradient-to-br from-drift/10 via-drift/[0.04] to-transparent p-4 sm:p-5">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-40 blur-2xl"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--drift) 35%, transparent), transparent 70%)" }}
      />
      <div className="relative flex items-center gap-3 mb-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-drift/15 text-drift-ink">
          <AlertTriangle className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="eyebrow text-drift-ink">Needs review</div>
          <h2 className="font-display text-lg leading-tight truncate">
            {entries.length} project{entries.length === 1 ? "" : "s"} with changes in the source
          </h2>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-2">
        {entries.map((entry) => {
          const project = projectsById.get(entry.projectId);
          const itemCount = driftItemCount(entry);
          return (
            <Link
              key={entry.projectId}
              to="/project/$id"
              params={{ id: entry.projectId }}
              className="group inline-flex items-center gap-2 rounded-xl border border-drift/30 bg-card/90 px-3 py-2 text-sm transition hover:border-drift hover:bg-drift/5"
            >
              <span className="font-medium truncate max-w-[180px]">{project?.name ?? "Project"}</span>
              <span className="text-[11px] font-mono-tight text-drift-ink shrink-0">
                {itemCount} change{itemCount === 1 ? "" : "s"} · {fmtRel(entry.detectedAt)}
              </span>
              <ArrowUpRight className="size-3.5 text-muted-foreground shrink-0 transition group-hover:text-drift" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Visu" },
      { name: "description", content: "Your Visu projects and quotas." },
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

/** Items taken from a source, and how many of them need a look (unclear,
 *  changed in the source, or sources disagree) -- the same grades the
 *  project page and each item's chip use. */
function projectStats(p: StoredProject) {
  const summary = addSummaries(p.canvases.map((c) => summarizeGrades(c.model)));
  return { count: summary.total, needsLook: summary.needsLook };
}

function needsLookWords(n: number) {
  return `${n} need${n === 1 ? "s" : ""} a look`;
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
      if (st.needsLook > 0) attn.push(p); else remaining.push(p);
    }
    return { continueProject: cont, needsAttention: attn, rest: remaining };
  }, [s.projects]);

  if (s.loading) {
    return (
      <div className="min-h-screen text-foreground">
        <Nav />
        <main className="mx-auto max-w-[1200px] px-4 pt-24 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!s.signedIn) {
    return (
      <div className="min-h-screen text-foreground">
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
    <div className="min-h-screen text-foreground">
      <Nav />
      <main className="mx-auto max-w-[1200px] px-4 pt-8 pb-24">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div className="min-w-0">
            <div className="eyebrow text-primary">
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
                <div className="eyebrow text-muted-foreground">
                  Free plan
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
            {/* With no projects yet, the empty state's New project is the one
                main action, so this one steps down to ordinary. */}
            <Button onClick={startNew} className="h-10" variant={s.projects.length === 0 ? "outline" : "default"}>
              <FolderPlus className="size-4" /> New project
            </Button>
          </div>
        </header>

        {s.projects.length > 0 && <NeedsReviewStrip projects={s.projects} />}

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
                  title="Items to check"
                  hint={`${needsAttention.length} project${needsAttention.length === 1 ? "" : "s"} with unclear, changed or disagreeing items`}
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
              <InboxCard projects={s.projects} />
              <TipsCard onNew={startNew} />
            </aside>
          </div>
        )}
      </main>

      <CheckoutModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        tier="Pro"
        price="$9/mo"
        unlocks={[
          "Unlimited projects and transcripts",
          "Drift detection & alerts",
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
              "eyebrow",
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
      className="group relative block overflow-hidden rounded-2xl border bg-card p-5 transition hover:border-primary/50 hover:bg-muted/30"
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
          <div className="eyebrow text-primary mb-1.5">
            Pick up
          </div>
          <h3 className="font-display text-2xl leading-tight truncate">{project.name}</h3>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 max-w-2xl">
              {project.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <KindChips project={project} />
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-muted-foreground">
              <Layers className="size-3" aria-hidden /> {st.count} item{st.count === 1 ? "" : "s"}
            </span>
            {st.needsLook > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-unresolved-ink">
                <AlertTriangle className="size-3" aria-hidden /> {needsLookWords(st.needsLook)}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-tight text-muted-foreground">
              <Clock className="size-3" /> {fmtRel(project.updatedAt)}
            </span>
          </div>
        </div>
        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-2.5 py-1.5 text-sm font-medium text-foreground transition group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/45">
          Open<span className="hidden sm:inline"> project</span> <ArrowUpRight className="size-4" />
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The rename and delete dialogs sit outside the menu. While one is opening,
  // the closing menu must not pull focus back to its trigger.
  const openingDialog = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="group relative rounded-xl border bg-card p-4 flex flex-col gap-3 transition hover:border-primary/50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* The title link stretches over the whole card (::after), so the card
              opens on click and is one tab stop; its focus ring is drawn
              around the card because the truncated title would clip it. */}
          <h3 className="font-display text-lg leading-tight truncate">
            <Link
              to="/project/$id"
              params={{ id: project.id }}
              className="after:absolute after:-inset-px after:rounded-xl focus-visible:outline-hidden focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring focus-visible:after:shadow-[0_0_0_2px_var(--focus-halo)]"
            >
              {project.name}
            </Link>
          </h3>
          {project.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{project.description}</p>
          )}
        </div>
        <div className="relative z-10 shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                className="grid size-7 place-items-center rounded-md border bg-background/60 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition focus:opacity-100 data-[state=open]:opacity-100"
                aria-label="Project actions"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end" className="w-40"
              onCloseAutoFocus={(e) => { if (openingDialog.current) { e.preventDefault(); openingDialog.current = false; } }}
            >
              <DropdownMenuItem onClick={() => navigate({ to: "/project/$id", params: { id: project.id } })}>
                <ExternalLink className="size-3.5" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { openingDialog.current = true; setRenameOpen(true); }}>
                <Pencil className="size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => { openingDialog.current = true; setDeleteOpen(true); }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <RenameProjectDialog
            project={project} open={renameOpen} onOpenChange={setRenameOpen}
            onClosed={() => triggerRef.current?.focus()}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Delete \u201c${project.name}\u201d?`}
            consequence="Its artifacts, sources, saved versions, comments and share links are deleted with it, and anyone with a share link loses access. This can't be undone."
            confirmLabel="Delete project"
            busyLabel="Deleting…"
            cancelLabel="Keep it"
            doing={`delete \u201c${project.name}\u201d`}
            onConfirm={() => sessionStore.deleteProject(project.id)}
            onCloseAutoFocus={(e) => {
              // Back to the card's menu when the project was kept; after a
              // delete the card is gone and focus is left to the page.
              if (triggerRef.current?.isConnected) { e.preventDefault(); triggerRef.current.focus(); }
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <KindChips project={project} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Layers className="size-3" aria-hidden /> {st.count} item{st.count === 1 ? "" : "s"}
          {st.needsLook > 0 && (
            <span className="ml-1 text-unresolved-ink">· {needsLookWords(st.needsLook)}</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {fmtRel(project.updatedAt)}
        </span>
      </div>
    </div>
  );
}

/** Renames in place of the browser's prompt box. Stays open while saving and
 *  shows a failure under the field, so the typed name is never lost. */
function RenameProjectDialog({
  project, open, onOpenChange, onClosed,
}: {
  project: StoredProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const next = name.trim();
  const canSave = next.length > 0 && next !== project.name && !busy;

  // Opened from the card's menu: start from the current name each time.
  useEffect(() => {
    if (open) { setName(project.name); setError(null); }
  }, [open, project.name]);

  const change = (o: boolean) => {
    if (busy) return;
    onOpenChange(o);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await sessionStore.updateProject(project.id, { name: next });
      setBusy(false);
      onOpenChange(false);
    } catch (err) {
      setBusy(false);
      setError(friendlyError(err, "rename this project"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(e) => {
          // Start with the whole name selected, ready to type over.
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
        onCloseAutoFocus={(e) => { e.preventDefault(); onClosed(); }}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>The new name shows everywhere this project appears.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={`rename-${project.id}`} className="text-sm font-medium text-foreground">
              Project name
            </label>
            <Input
              ref={inputRef}
              id={`rename-${project.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <InlineError error={error} />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {busy ? <><Loader2 className="animate-spin" aria-hidden /> Renaming…</> : "Rename project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Short names for the chips, in the order the project page lists them. */
const KIND_CHIPS: [ViewKind, string][] = [
  ["process", "Process map"], ["bmc", "BMC"], ["dfd", "DFD"], ["raci", "RACI"],
  ["decisiontree", "Decision tree"], ["statediagram", "State diagram"], ["activity", "Activity"],
];

/** One chip for each kind of artifact the project has (a project made
 *  before artifacts were listed one by one falls back to its kinds). */
function KindChips({ project }: { project: StoredProject }) {
  const have = new Set<ViewKind>(project.canvases.length > 0
    ? project.canvases.map((c) => c.viewKind ?? c.kind)
    : project.kinds);
  const chip = "inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-2xs font-mono-tight";
  return (
    <>
      {KIND_CHIPS.filter(([k]) => have.has(k)).map(([k, label]) => (
        <span key={k} className={chip}>
          {k === "process" ? <Workflow className="size-3" /> : k === "bmc" ? <LayoutGrid className="size-3" /> : null} {label}
        </span>
      ))}
      {project.fromScratch && (
        <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-2xs font-mono-tight text-muted-foreground">
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
      <div className="eyebrow text-primary mb-1">
        {label} plan
      </div>
      <h3 className="font-display text-lg leading-tight">All features unlocked.</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Unlimited projects, drift detection, version history, and source traceability are on.
      </p>
    </div>
  );
}

/* ───────────────────────── Inbox (comments) ───────────────────────── */

function resolveItemText(project: StoredProject | undefined, itemId: string | null): string | null {
  if (!project || !itemId) return null;
  for (const c of project.canvases) {
    const hit = allItems(c.model).find((i) => i.id === itemId);
    if (hit) return hit.text;
  }
  return null;
}

/** Recent comments across every project in the org, with real @mentions
 *  (parsed at post time in sessionStore.addComment) surfaced and sorted
 *  first -- "someone tagged you" is a stronger signal than general recent
 *  activity, so those entries bubble up with a highlight instead of being
 *  buried in chronological order. The project route's /project/$id route
 *  has no typed search schema, so this navigates with a plain query string
 *  rather than the router's typed search API -- the same pattern the
 *  checkout-success redirect already uses elsewhere in this app. */
function InboxCard({ projects }: { projects: StoredProject[] }) {
  const session = useSession();
  const [comments, setComments] = useState<
    { id: string; projectId: string; itemId: string | null; body: string; authorEmail: string; createdAt: number }[] | null
  >(null);
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const projectIds = projects.map((p) => p.id);
    const userId = session.userId;
    sessionStore.listRecentCommentsForProjects(projectIds)
      .then((list) => {
        setComments(list);
        if (userId) {
          sessionStore.listMentionedCommentIds(userId, list.map((c) => c.id))
            .then(setMentionedIds)
            .catch(() => setMentionedIds(new Set()));
        }
      })
      .catch(() => setComments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).sort().join(","), session.userId]);

  if (!comments || comments.length === 0) return null;
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const sorted = [...comments].sort((a, b) => {
    const am = mentionedIds.has(a.id) ? 1 : 0;
    const bm = mentionedIds.has(b.id) ? 1 : 0;
    return bm - am || b.createdAt - a.createdAt;
  });

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 eyebrow text-muted-foreground mb-2">
        <MessageSquare className="size-3" /> Inbox
      </div>
      <ul className="space-y-3">
        {sorted.map((c) => {
          const project = projectsById.get(c.projectId);
          const itemText = resolveItemText(project, c.itemId);
          const mentioned = mentionedIds.has(c.id);
          return (
            <li key={c.id}>
              <button
                onClick={() => {
                  const path = `/project/${c.projectId}${c.itemId ? `?focusItem=${encodeURIComponent(c.itemId)}` : ""}`;
                  window.location.href = path;
                }}
                className={cn(
                  "w-full text-left group rounded-lg p-1.5 -m-1.5 transition",
                  mentioned && "bg-primary/5 hover:bg-primary/10",
                  !mentioned && "hover:bg-muted/60",
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium text-foreground truncate">{c.authorEmail}</span>
                    {mentioned && (
                      <span className="shrink-0 rounded-sm bg-primary/15 text-primary px-1.5 py-0.5 text-[11px] leading-tight font-mono-tight">
                        @you
                      </span>
                    )}
                  </span>
                  <span className="shrink-0">{fmtRel(c.createdAt)}</span>
                </div>
                <p className="text-xs text-foreground/90 line-clamp-2 mt-0.5 group-hover:text-primary transition">
                  {c.body}
                </p>
                <p className="text-2xs text-muted-foreground mt-0.5 truncate">
                  on {itemText ? `"${itemText}"` : "the project thread"} · {project?.name ?? "Project"}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TipsCard({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="eyebrow text-muted-foreground mb-1">
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
            <span>See what Visu does</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

/* ───────────────────────── Bits ───────────────────────── */

function TierPill({ tier, onUpgrade }: { tier: Tier; onUpgrade: () => void }) {
  const label = tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Team";
  const base = "inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium";
  // A paid plan only describes itself, so it is a label chip rather than a
  // button that can take focus and do nothing.
  if (tier !== "free") {
    return (
      <span className={cn(base, "bg-primary/10 border-primary/40 text-primary")} title={`Current plan: ${label}`}>
        {label} plan
      </span>
    );
  }
  return (
    <button
      onClick={onUpgrade}
      className={cn(base, "border-dashed border-primary/40 text-primary transition hover:bg-primary/5 cursor-pointer")}
    >
      Upgrade to Pro
    </button>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/60 p-12 text-center bp-grid-fine">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-card mb-4">
        <FolderPlus className="size-5 text-primary" />
      </div>
      <h2 className="font-display text-2xl">Nothing here yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
        Start a project from a transcript, a template, or a blank canvas. You don't need a source to begin —
        you can paste one anytime later.
      </p>
      <Button onClick={onStart} className="mt-6"><FolderPlus className="size-4" /> New project</Button>
    </div>
  );
}
