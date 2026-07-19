-- The previous migration's policies checked org membership via a subquery
-- directly on organization_members from within organization_members' own
-- policy, which forces Postgres to re-apply that same policy to evaluate
-- itself -- infinite recursion (confirmed live: every read on organizations,
-- organization_members, projects, and project_snapshots returned HTTP 500
-- "infinite recursion detected in policy for relation organization_members").
--
-- Fix: SECURITY DEFINER helper functions bypass RLS internally (tables here
-- are not FORCE ROW LEVEL SECURITY, so a definer-owned function reading
-- organization_members does not re-trigger its policy), so every policy
-- that needs "is this user a member/owner of this org" now calls a function
-- instead of subquerying the RLS-protected table directly.

create or replace function public.is_org_member(check_org_id uuid) returns boolean as $$
  select exists (
    select 1 from public.organization_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = public;

create or replace function public.is_org_owner(check_org_id uuid) returns boolean as $$
  select exists (
    select 1 from public.organization_members
    where org_id = check_org_id and user_id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable set search_path = public;

-- organizations
drop policy "org_select_member" on public.organizations;
drop policy "org_update_owner" on public.organizations;
create policy "org_select_member" on public.organizations for select
  using (public.is_org_member(id));
create policy "org_update_owner" on public.organizations for update
  using (public.is_org_owner(id));

-- organization_members (the table that was actually recursing)
drop policy "org_members_select_fellow_member" on public.organization_members;
drop policy "org_members_owner_manages" on public.organization_members;
create policy "org_members_select_fellow_member" on public.organization_members for select
  using (public.is_org_member(org_id));
create policy "org_members_owner_manages" on public.organization_members for all
  using (public.is_org_owner(org_id));

-- organization_invites
drop policy "org_invites_member_select" on public.organization_invites;
drop policy "org_invites_owner_manages" on public.organization_invites;
drop policy "org_invites_owner_deletes" on public.organization_invites;
create policy "org_invites_member_select" on public.organization_invites for select
  using (public.is_org_member(org_id));
create policy "org_invites_owner_manages" on public.organization_invites for insert
  with check (public.is_org_owner(org_id));
create policy "org_invites_owner_deletes" on public.organization_invites for delete
  using (public.is_org_owner(org_id));

-- projects
drop policy "projects_select_org_member" on public.projects;
drop policy "projects_insert_org_member" on public.projects;
drop policy "projects_update_org_member" on public.projects;
drop policy "projects_delete_org_member" on public.projects;
create policy "projects_select_org_member" on public.projects for select
  using (public.is_org_member(org_id));
create policy "projects_insert_org_member" on public.projects for insert
  with check (public.is_org_member(org_id));
create policy "projects_update_org_member" on public.projects for update
  using (public.is_org_member(org_id));
create policy "projects_delete_org_member" on public.projects for delete
  using (public.is_org_member(org_id));

-- project_snapshots (joined through projects -> organization_members, same recursion risk)
drop policy "snapshots_select_org_member" on public.project_snapshots;
drop policy "snapshots_insert_org_member" on public.project_snapshots;
create policy "snapshots_select_org_member" on public.project_snapshots for select
  using (exists (select 1 from public.projects p where p.id = project_snapshots.project_id and public.is_org_member(p.org_id)));
create policy "snapshots_insert_org_member" on public.project_snapshots for insert
  with check (exists (select 1 from public.projects p where p.id = project_snapshots.project_id and public.is_org_member(p.org_id)));
