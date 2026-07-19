-- CSRF protection for the Slack OAuth flow: slack-oauth-start mints a
-- single-use state token tied to (org_id, user_id) before redirecting to
-- Slack; slack-oauth-callback (which runs with no user JWT -- Slack doesn't
-- forward one) verifies the state it gets back matches a real, unexpired,
-- not-yet-used row before trusting the org_id in the request at all.
-- Edge-function-only access (service role), no client-facing policies.
create table public.slack_oauth_state (
  state uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.slack_oauth_state enable row level security;

-- Also uses the incoming-webhook OAuth scope rather than chat:write + a
-- separate channel-picker UI -- Slack's own consent screen already asks the
-- installing user which channel to post to, and the token exchange returns
-- a ready-to-POST webhook URL scoped to that choice.
alter table public.org_slack_integration add column webhook_url text not null;
