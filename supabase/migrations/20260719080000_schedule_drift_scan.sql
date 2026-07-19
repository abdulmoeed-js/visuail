-- Daily 06:00 UTC trigger of scheduled-drift-scan (Pro/Team projects only,
-- enforced inside the function itself). pg_net calls need to present the
-- project's service-role key as a bearer token so the function can tell
-- "this is really the cron job" from "someone hit the URL directly" --
-- REPLACE_WITH_SERVICE_ROLE_KEY below with the real value from
-- Project Settings -> API -> service_role secret before running this.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'daily-drift-scan',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://osnpexjxxwwvsjfegmga.supabase.co/functions/v1/scheduled-drift-scan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
