-- Detections from the scheduled background scan (scheduled-drift-scan edge
-- function). Deliberately separate from project_snapshots: an unattended
-- scan should never silently overwrite a project's live canvases (nobody's
-- there to review a merge conflict against manual edits) -- it only records
-- that drift was found. Applying the change still goes through the existing
-- interactive "Re-check for drift" button, which does the full
-- reconcile-with-manual-edits flow. This table is the record a
-- notification (Slice C) reads from, and the badge a human sees before
-- deciding to click that button.
create table public.drift_alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  detected_at timestamptz not null default now(),
  drifted_summary jsonb not null,
  notified_at timestamptz
);
create index drift_alerts_project_id_idx on public.drift_alerts(project_id, detected_at desc);

alter table public.drift_alerts enable row level security;

create policy "drift_alerts_select_org_member" on public.drift_alerts for select
  using (exists (select 1 from public.projects p where p.id = drift_alerts.project_id and public.is_org_member(p.org_id)));
