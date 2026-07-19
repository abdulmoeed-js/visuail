-- Basic usage observability (Supabase Slice 6). Deliberately minimal: one
-- append-only events table and a handful of tracked event types, not a full
-- analytics platform. Org-scoped so an org owner can see their own
-- workspace's activity; no cross-org visibility, no admin/global view yet.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index usage_events_org_id_idx on public.usage_events(org_id, created_at desc);

alter table public.usage_events enable row level security;

create policy "usage_events_select_org_member" on public.usage_events for select
  using (public.is_org_member(org_id));
create policy "usage_events_insert_org_member" on public.usage_events for insert
  with check (public.is_org_member(org_id));
