-- Payments Slice 6: billing portal link.
--
-- LemonSqueezy includes a ready-to-use customer-portal URL directly on the
-- subscription object in every webhook payload (data.attributes.urls.customer_portal),
-- so there's no need for a separate live API call each time someone clicks
-- "Manage billing" -- the webhook just captures it once and the frontend
-- reads it straight off the subscriptions row it can already SELECT.

alter table public.subscriptions add column if not exists portal_url text;
