-- Rate-limit log for real (LLM-backed) extraction calls. Each row is one
-- extraction request; the edge function counts a user's rows in the last
-- hour before deciding whether to allow another call, since a real Claude
-- API call costs real money per request.
create table public.extraction_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.extraction_log enable row level security;

create policy "select own extraction log"
  on public.extraction_log for select
  using (auth.uid() = user_id);

create policy "insert own extraction log"
  on public.extraction_log for insert
  with check (auth.uid() = user_id);

create index extraction_log_user_time_idx
  on public.extraction_log (user_id, created_at desc);
