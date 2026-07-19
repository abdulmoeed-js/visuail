-- profiles_select_own (from the original schema) only lets a user read
-- their own row, which blocks displaying "who saved this version" /
-- "who commented" / an org's member list anywhere -- all three need to read
-- a fellow org member's email. Adds a second SELECT policy (policies for
-- the same command are OR'd) so you can also read the profile of anyone
-- who shares at least one org with you; still no visibility into unrelated
-- users' profiles.
create policy "profiles_select_org_fellow" on public.profiles for select
  using (
    exists (
      select 1 from public.organization_members m1
      join public.organization_members m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );
