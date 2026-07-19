-- Payments Slice 1: subscriptions table + close the client-side tier exploit.
--
-- Today, sessionStore.setTier() is a bare client UPDATE on organizations.tier
-- with no payment behind it -- any signed-in org owner can grant themselves
-- Team for free via devtools. This migration makes that impossible at the
-- database level: the tier column becomes writable only by service_role
-- (i.e. only the lemonsqueezy-webhook edge function, on a verified payment
-- event), not by the authenticated role at all, regardless of what the
-- client code does or doesn't call.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'lemonsqueezy',
  provider_subscription_id text not null,
  provider_customer_id text,
  status text not null check (status = any (array['active', 'past_due', 'cancelled', 'expired', 'paused'])),
  tier text not null check (tier = any (array['pro', 'team'])),
  seats integer not null default 1,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists subscriptions_org_id_idx on public.subscriptions(org_id);

alter table public.subscriptions enable row level security;

-- Org members can read their own org's subscription. No insert/update/delete
-- policy exists for authenticated/anon -- only service_role (which bypasses
-- RLS entirely) can write, which is exactly what the webhook function uses.
create policy subscriptions_select_member on public.subscriptions
  for select using (public.is_org_member(org_id));

-- The actual exploit fix: column-level revoke survives even if a future
-- client update policy is accidentally added for organizations, since this
-- blocks the tier column specifically, not just the row.
revoke update (tier) on public.organizations from authenticated;
revoke update (tier) on public.organizations from anon;
