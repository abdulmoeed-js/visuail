-- Real Slack OAuth connection per org (Drift-watch Slice C). One org has at
-- most one Slack workspace connected, posting drift alerts to one chosen
-- channel. access_token is only ever read/written by edge functions using
-- the service role, so there is no client-facing SELECT policy exposing it
-- -- an org member can see THAT Slack is connected and to which channel,
-- never the token itself.
create table public.org_slack_integration (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  access_token text not null,
  slack_team_name text not null,
  channel_id text not null,
  channel_name text not null,
  installed_by uuid not null references public.profiles(id) on delete cascade,
  installed_at timestamptz not null default now()
);

alter table public.org_slack_integration enable row level security;

-- Any member can see the row exists (via the _public view below, which
-- excludes access_token); only the owner can read/write this table directly.
create policy "slack_integration_select_org_owner" on public.org_slack_integration for select
  using (public.is_org_owner(org_id));
create policy "slack_integration_delete_org_owner" on public.org_slack_integration for delete
  using (public.is_org_owner(org_id));

-- Org members can see connection status/channel, never the token. Does NOT
-- use security_invoker -- it needs to bypass the owner-only base table RLS
-- above (that's the whole point), so its own WHERE clause is the real
-- access check, using the same is_org_member() every other policy uses.
create view public.org_slack_integration_public as
  select org_id, slack_team_name, channel_id, channel_name, installed_by, installed_at
  from public.org_slack_integration
  where public.is_org_member(org_id);

grant select on public.org_slack_integration_public to authenticated;

-- Simple per-org email address for drift notifications -- separate from
-- Slack, either or both can be configured.
alter table public.organizations add column notification_email text;
