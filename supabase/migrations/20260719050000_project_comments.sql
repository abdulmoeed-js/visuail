-- Project-level discussion. item_id is nullable and unused today -- schema
-- supports per-item threaded comments later without a migration, but the
-- UI in this pass is a single project-wide thread, not per-item popovers.
create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index project_comments_project_id_idx on public.project_comments(project_id, created_at);

alter table public.project_comments enable row level security;

create policy "comments_select_org_member" on public.project_comments for select
  using (exists (
    select 1 from public.projects p
    where p.id = project_comments.project_id and public.is_org_member(p.org_id)
  ));
create policy "comments_insert_org_member" on public.project_comments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_comments.project_id and public.is_org_member(p.org_id))
  );
create policy "comments_delete_own" on public.project_comments for delete
  using (user_id = auth.uid());
