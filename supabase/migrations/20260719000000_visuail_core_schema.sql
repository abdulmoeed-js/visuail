create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  tier text not null default 'free' check (tier in ('free','pro','team')),
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  kinds text[] not null default '{}',
  sources jsonb not null default '[]',
  canvases jsonb not null default '[]',
  from_scratch boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on public.projects(user_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.check_project_cap() returns trigger as $$
declare
  user_tier text;
  project_count int;
begin
  select tier into user_tier from public.profiles where id = new.user_id;
  if user_tier = 'free' then
    select count(*) into project_count from public.projects where user_id = new.user_id;
    if project_count >= 2 then
      raise exception 'Free tier is limited to 2 projects. Upgrade to Pro for unlimited.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger enforce_project_cap
  before insert on public.projects
  for each row execute function public.check_project_cap();
