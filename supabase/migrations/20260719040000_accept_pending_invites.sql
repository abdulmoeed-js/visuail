-- handle_new_user() only resolves pending invites for BRAND NEW signups
-- (it's a trigger on auth.users insert). Someone invited who already has a
-- Visuail account never re-triggers that insert, so their invite would sit
-- pending forever. Extracts the resolution loop into a reusable function and
-- adds a public RPC version callable on every sign-in (idempotent -- a user
-- with no pending invites is a no-op).

create or replace function public.accept_pending_invites_for(target_user_id uuid, target_email text) returns void as $$
declare
  inv record;
begin
  for inv in select * from public.organization_invites
    where email = target_email and accepted_at is null
  loop
    insert into public.organization_members (org_id, user_id, role)
    values (inv.org_id, target_user_id, 'member')
    on conflict do nothing;
    update public.organization_invites set accepted_at = now() where id = inv.id;
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

-- Public RPC: resolves the CALLING user's own pending invites only (reads
-- their email from their own profile, never an arbitrary email).
create or replace function public.accept_pending_invites() returns void as $$
declare
  my_email text;
begin
  select email into my_email from public.profiles where id = auth.uid();
  if my_email is not null then
    perform public.accept_pending_invites_for(auth.uid(), my_email);
  end if;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.handle_new_user() returns trigger as $$
declare
  new_org_id uuid;
begin
  insert into public.profiles (id, email) values (new.id, new.email);

  insert into public.organizations (name, tier, is_personal)
  values ('Personal workspace', 'free', true)
  returning id into new_org_id;

  insert into public.organization_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  perform public.accept_pending_invites_for(new.id, new.email);

  return new;
end;
$$ language plpgsql security definer set search_path = public;
