-- Tracks which weekly flight schedules have already been announced in Discord,
-- so the bot can catch up after a sleep, restart, or redeploy instead of
-- silently skipping the week. Run once in the Supabase SQL Editor.
create table if not exists public.weekly_announcements (
  week_start date primary key,
  posted_at timestamptz not null default now()
);

alter table public.weekly_announcements enable row level security;
