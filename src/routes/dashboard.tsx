import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Nav } from "@/components/Nav";
import { useSession, sessionStore, FREE_LIMIT, type StoredProject } from "@/lib/session";
import { allItems } from "@/data/samples";
import {
  FolderPlus, Workflow, LayoutGrid, ArrowUpRight, Trash2, ShieldCheck,
  Clock, Sparkles, Info, Loader2, LogIn,
} from "lucide-react";
import { useState } from "react";
import { CheckoutModal } from "@/components/CheckoutModal";
import { SignupWallModal } from "@/components/SignupWallModal";
import { cn } from "@/lib/utils";

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

  const remaining = s.tier === "free" ? Math.max(0, FREE_LIMIT - s.projects.length) : Infinity;

  const startNew = () => {
    const check = sessionStore.canCreateProject(s.projects.length, s.tier);
    if (!check.ok) { setUpgradeOpen(true); return; }
    navigate({ to: "/new" });
  };

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
            Projects are tied to your account now, not just this browser — so they follow you across devices.
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
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">
              Dashboard
            </div>
            <h1 className="font-display text-3xl md:text-4xl mt-1">Your projects</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">
              Signed in as {s.email}. Your projects follow you across devices now.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TierPill tier={s.tier} onUpgrade={() => setUpgradeOpen(true)} />
            <Button onClick={startNew} className="h-10">
              <FolderPlus className="size-4" /> New project
            </Button>
          </div>
        </div>

        {s.tier === "free" && (
          <div className="mb-6 rounded-lg border bg-card/60 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Info className="size-4 text-muted-foreground" />
              <span>
                <strong>{s.projects.length} of {FREE_LIMIT}</strong> projects used on the Free tier.
                {remaining === 0 && " Upgrade to Pro for unlimited projects."}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setUpgradeOpen(true)}>
              <Sparkles className="size-3.5" /> Upgrade
            </Button>
          </div>
        )}

        {s.projects.length === 0 ? (
          <EmptyState onStart={startNew} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.projects.map(p => (
              <ProjectCard key={p.id} project={p} />
            ))}
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

function TierPill({ tier, onUpgrade }: { tier: "free" | "pro" | "team"; onUpgrade: () => void }) {
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

function ProjectCard({ project }: { project: StoredProject }) {
  const st = projectStats(project);
  return (
    <Link
      to="/project/$id"
      params={{ id: project.id }}
      className="group rounded-xl border bg-card p-4 flex flex-col gap-3 transition hover:border-primary/50 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg leading-tight truncate">{project.name}</h3>
          {project.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{project.description}</p>
          )}
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {project.kinds.includes("process") && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
            <Workflow className="size-3" /> Process map
          </span>
        )}
        {project.kinds.includes("bmc") && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
            <LayoutGrid className="size-3" /> BMC
          </span>
        )}
        {project.fromScratch && (
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] font-mono-tight text-muted-foreground">
            empty
          </span>
        )}
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
      <button
        onClick={(e) => {
          e.preventDefault();
          if (confirm(`Delete "${project.name}"? This can't be undone.`)) {
            sessionStore.deleteProject(project.id).catch((err) => {
              alert(err instanceof Error ? err.message : "Couldn't delete this project. Try again.");
            });
          }
        }}
        className="absolute opacity-0 pointer-events-none"
        aria-hidden
      >
        <Trash2 className="size-3" />
      </button>
    </Link>
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
