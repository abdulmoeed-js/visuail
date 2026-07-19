-- Org/workspace model. Every user belongs to at least one organization (a
-- personal org created on signup) and can additionally belong to Team orgs
-- they're invited into. Billing tier moves from profiles to organizations,
-- since it's the workspace being paid for, not the individual.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null default 'free' check (tier in ('free','pro','team')),
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members(user_id);

-- Pending invites: a row with an email but no user_id yet, resolved into a
-- real organization_members row on that email's first sign-in (see
-- resolve_pending_invites(), called from handle_new_user()).
create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index organization_invites_email_idx on public.organization_invites(email) where accepted_at is null;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;

create policy "org_select_member" on public.organizations for select
  using (exists (select 1 from public.organization_members m where m.org_id = organizations.id and m.user_id = auth.uid()));
create policy "org_update_owner" on public.organizations for update
  using (exists (select 1 from public.organization_members m where m.org_id = organizations.id and m.user_id = auth.uid() and m.role = 'owner'));

create policy "org_members_select_fellow_member" on public.organization_members for select
  using (exists (select 1 from public.organization_members m2 where m2.org_id = organization_members.org_id and m2.user_id = auth.uid()));
create policy "org_members_owner_manages" on public.organization_members for all
  using (exists (select 1 from public.organization_members m2 where m2.org_id = organization_members.org_id and m2.user_id = auth.uid() and m2.role = 'owner'));

create policy "org_invites_member_select" on public.organization_invites for select
  using (exists (select 1 from public.organization_members m where m.org_id = organization_invites.org_id and m.user_id = auth.uid()));
create policy "org_invites_owner_manages" on public.organization_invites for insert
  with check (exists (select 1 from public.organization_members m where m.org_id = organization_invites.org_id and m.user_id = auth.uid() and m.role = 'owner'));
create policy "org_invites_owner_deletes" on public.organization_invites for delete
  using (exists (select 1 from public.organization_members m where m.org_id = organization_invites.org_id and m.user_id = auth.uid() and m.role = 'owner'));

-- Seat cap: Team tier bundles 3 seats. Enforced at insert time, same pattern
-- as check_project_cap().
create function public.check_seat_cap() returns trigger as $$
declare
  org_tier text;
  member_count int;
begin
  select tier into org_tier from public.organizations where id = new.org_id;
  if org_tier = 'team' then
    select count(*) into member_count from public.organization_members where org_id = new.org_id;
    if member_count >= 3 then
      raise exception 'Team tier is limited to 3 bundled seats. Contact us for additional seats.';
    end if;
  elsif org_tier in ('free','pro') then
    if exists (select 1 from public.organization_members where org_id = new.org_id) then
      raise exception 'This workspace does not support additional members on its current plan.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger enforce_seat_cap
  before insert on public.organization_members
  for each row execute function public.check_seat_cap();

-- Repoint projects at organizations instead of individual users.
alter table public.projects add column org_id uuid references public.organizations(id) on delete cascade;

-- Backfill: one personal org per existing profile, tier copied over, that
-- profile as owner, and every one of their existing projects repointed.
do $$
declare
  p record;
  new_org_id uuid;
begin
  for p in select id, tier from public.profiles loop
    insert into public.organizations (name, tier, is_personal)
    values ('Personal workspace', p.tier, true)
    returning id into new_org_id;

    insert into public.organization_members (org_id, user_id, role)
    values (new_org_id, p.id, 'owner');

    update public.projects set org_id = new_org_id where user_id = p.id;
  end loop;
end $$;

alter table public.projects alter column org_id set not null;
create index projects_org_id_idx on public.projects(org_id);

-- Replace user-scoped RLS with org-scoped RLS.
drop policy "projects_select_own" on public.projects;
drop policy "projects_insert_own" on public.projects;
drop policy "projects_update_own" on public.projects;
drop policy "projects_delete_own" on public.projects;

create policy "projects_select_org_member" on public.projects for select
  using (exists (select 1 from public.organization_members m where m.org_id = projects.org_id and m.user_id = auth.uid()));
create policy "projects_insert_org_member" on public.projects for insert
  with check (exists (select 1 from public.organization_members m where m.org_id = projects.org_id and m.user_id = auth.uid()));
create policy "projects_update_org_member" on public.projects for update
  using (exists (select 1 from public.organization_members m where m.org_id = projects.org_id and m.user_id = auth.uid()));
create policy "projects_delete_org_member" on public.projects for delete
  using (exists (select 1 from public.organization_members m where m.org_id = projects.org_id and m.user_id = auth.uid()));

-- check_project_cap becomes org-scoped instead of user-scoped, and now
-- reads new.org_id instead of new.user_id.
create or replace function public.check_project_cap() returns trigger as $$
declare
  org_tier text;
  project_count int;
begin
  select tier into org_tier from public.organizations where id = new.org_id;
  if org_tier = 'free' then
    select count(*) into project_count from public.projects where org_id = new.org_id;
    if project_count >= 2 then
      raise exception 'Free tier is limited to 2 projects. Upgrade to Pro for unlimited.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- New users get a personal org too, and any pending invites for their email
-- resolve into real memberships.
create or replace function public.handle_new_user() returns trigger as $$
declare
  new_org_id uuid;
  inv record;
begin
  insert into public.profiles (id, email) values (new.id, new.email);

  insert into public.organizations (name, tier, is_personal)
  values ('Personal workspace', 'free', true)
  returning id into new_org_id;

  insert into public.organization_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  for inv in select * from public.organization_invites
    where email = new.email and accepted_at is null
  loop
    insert into public.organization_members (org_id, user_id, role)
    values (inv.org_id, new.id, 'member')
    on conflict do nothing;
    update public.organization_invites set accepted_at = now() where id = inv.id;
  end loop;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Version snapshots: append-only, powers version history, drift-watch
-- baselines, and the audit trail — one table, three consumers.
create table public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  canvases jsonb not null,
  trigger text not null check (trigger in ('manual_save','source_added','drift_recheck','manual_edit')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_snapshots_project_id_idx on public.project_snapshots(project_id, created_at desc);

alter table public.project_snapshots enable row level security;
create policy "snapshots_select_org_member" on public.project_snapshots for select
  using (exists (
    select 1 from public.projects p
    join public.organization_members m on m.org_id = p.org_id
    where p.id = project_snapshots.project_id and m.user_id = auth.uid()
  ));
create policy "snapshots_insert_org_member" on public.project_snapshots for insert
  with check (exists (
    select 1 from public.projects p
    join public.organization_members m on m.org_id = p.org_id
    where p.id = project_snapshots.project_id and m.user_id = auth.uid()
  ));
