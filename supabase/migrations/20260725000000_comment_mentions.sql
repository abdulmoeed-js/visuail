-- Real @mention parsing for comments (previously flagged as a gap: "no one
-- is pinged today"). A comment's body can reference org members as
-- "@localpart" (the part of their email before the @, e.g. "@moeed.ashraf"
-- for moeed.ashraf@gmail.com) -- addComment() parses this at post time and
-- records a row here per matched member, which both the composer's
-- autocomplete and the dashboard inbox read back.
create table public.comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.project_comments(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);
create index comment_mentions_mentioned_user_idx on public.comment_mentions(mentioned_user_id, created_at desc);

alter table public.comment_mentions enable row level security;

-- Same visibility as the comment itself: any org member can see who was tagged.
create policy "comment_mentions_select_org_member" on public.comment_mentions for select
  using (exists (
    select 1 from public.project_comments c
    join public.projects p on p.id = c.project_id
    where c.id = comment_mentions.comment_id and public.is_org_member(p.org_id)
  ));

-- Only the comment's own author can tag people in it -- you cannot
-- retroactively add a mention to someone else's comment.
create policy "comment_mentions_insert_comment_author" on public.comment_mentions for insert
  with check (exists (
    select 1 from public.project_comments c
    where c.id = comment_mentions.comment_id and c.user_id = auth.uid()
  ));
