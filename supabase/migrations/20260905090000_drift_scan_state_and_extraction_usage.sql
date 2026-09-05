-- Cost levers for the extraction pipeline (see the 2026-09-05 unit-economics review).
--
-- 1. Skip unchanged sources in the nightly drift scan. The scan used to
--    re-extract every source of every paid project daily whether or not the
--    text changed -- ~$0.64/source/month on Sonnet 4.5, and re-extracting
--    identical text mostly measures model run-to-run variance, which surfaced
--    as false "drift" alerts. Store a hash of the sources at scan time so the
--    cron can skip projects whose sources are byte-identical to last time.
alter table public.projects
  add column if not exists drift_scan_sources_hash text,
  add column if not exists drift_scan_at timestamptz;

-- 2. Log Anthropic usage per extraction so prompt caching can be *measured*
--    (cache_read_input_tokens > 0 on warm calls) instead of assumed, and so
--    the interactive rate limit can exclude cron-originated rows -- the scan
--    inserts under the project creator's user_id and was quietly eating into
--    their 30/hour interactive budget at 06:00 every day.
alter table public.extraction_log
  add column if not exists source text check (source in ('interactive', 'scan')),
  add column if not exists model text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists cache_creation_input_tokens integer,
  add column if not exists cache_read_input_tokens integer;
