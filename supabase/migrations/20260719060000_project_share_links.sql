-- Real "Share link" (anyone with the URL, no login needed, read-only).
-- Deliberately NOT exposed via a direct anon RLS policy on projects --
-- that shape invites token enumeration/probing against a broadly-readable
-- table. Instead, org members manage share_links normally (authenticated,
-- org-scoped RLS below), and the public read path is a single narrow
-- SECURITY DEFINER function that does exactly one lookup by exact token
-- match, same pattern as this schema's other SECURITY DEFINER functions.
create table public.project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  -- Raw source transcripts can contain sensitive verbatim client statements;
  -- off by default, opt-in per link.
  include_sources boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index project_share_links_token_idx on public.project_share_links(token) where revoked_at is null;
create index project_share_links_project_id_idx on public.project_share_links(project_id);

alter table public.project_share_links enable row level security;

create policy "share_links_select_org_member" on public.project_share_links for select
  using (exists (select 1 from public.projects p where p.id = project_share_links.project_id and public.is_org_member(p.org_id)));
create policy "share_links_insert_org_member" on public.project_share_links for insert
  with check (exists (select 1 from public.projects p where p.id = project_share_links.project_id and public.is_org_member(p.org_id)));
create policy "share_links_update_org_member" on public.project_share_links for update
  using (exists (select 1 from public.projects p where p.id = project_share_links.project_id and public.is_org_member(p.org_id)));

create or replace function public.get_shared_project(share_token text)
returns table (id uuid, name text, description text, kinds text[], canvases jsonb, sources jsonb) as $$
  select p.id, p.name, p.description, p.kinds, p.canvases,
    case when l.include_sources then p.sources else '[]'::jsonb end as sources
  from public.project_share_links l
  join public.projects p on p.id = l.project_id
  where l.token = share_token and l.revoked_at is null
  limit 1;
$$ language sql security definer stable set search_path = public;

grant execute on function public.get_shared_project(text) to anon, authenticated;
