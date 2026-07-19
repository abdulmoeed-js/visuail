// Public, unauthenticated read-only view of a shared project. No Nav sign-in
// gate, no session lookup for authorization -- get_shared_project() is the
// entire access-control boundary (see the project_share_links migration).
//
// Reuses ArtifactView for rendering (same component the real project page
// uses) but never wires a persistence callback -- any interaction a viewer
// makes stays local to their own browser and is discarded on refresh. RLS
// would reject an anon write attempt regardless; this just means the UI
// never tries one in the first place.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Link2Off, ArrowRight, FileText } from "lucide-react";
import { ArtifactView } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import { stats } from "@/data/samples";
import { getSharedProject, type SharedProject } from "@/lib/session";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared project — Visuail" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<SharedProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedProject(token).then((p) => { if (!cancelled) { setProject(p); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-card mb-4">
            <Link2Off className="size-5 text-muted-foreground" />
          </div>
          <h1 className="font-display text-2xl">This link is no longer active.</h1>
          <p className="text-sm text-muted-foreground mt-2">
            It may have been revoked, or never existed.
          </p>
          <Link to="/" className="inline-flex items-center gap-1 mt-6 text-sm text-primary hover:underline">
            Go to Visuail <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b sticky top-0 z-10 bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-display text-lg tracking-tight">Visuail</Link>
          <span className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground border rounded-full px-2 py-0.5">
            Read-only shared view
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 pt-6 pb-16">
        <h1 className="font-display text-2xl md:text-3xl">{project.name}</h1>
        {project.description && <p className="text-sm text-muted-foreground mt-1">{project.description}</p>}

        {project.sources.length > 0 && (
          <div className="mt-4 rounded-lg border bg-card/60 p-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <FileText className="size-3.5 text-muted-foreground" />
            <span className="font-mono-tight uppercase tracking-widest text-muted-foreground">Sources</span>
            {project.sources.map((s, i) => (
              <span key={i} className="rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">{s.label}</span>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-6">
          {project.canvases.map((c) => (
            <SharedCanvas key={c.kind} model={c.model} />
          ))}
          {project.canvases.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-12">This project has no canvases yet.</p>
          )}
        </div>
      </main>
    </div>
  );
}

function SharedCanvas({ model }: { model: SharedProject["canvases"][number]["model"] }) {
  const editing = useArtifactEditing(model);
  const st = stats(editing.model);
  return (
    <div className="rounded-xl border bg-card min-h-[480px] flex flex-col">
      <ArtifactView editing={editing} stats={st} onPublish={() => {}} />
    </div>
  );
}
