-- Missed in the original drift_alerts migration: dismissing an alert (the
-- UI's "Dismiss" action) is an UPDATE (sets notified_at), and only a SELECT
-- policy existed.
create policy "drift_alerts_update_org_member" on public.drift_alerts for update
  using (exists (select 1 from public.projects p where p.id = drift_alerts.project_id and public.is_org_member(p.org_id)));
