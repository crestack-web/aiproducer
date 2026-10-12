-- Product analytics events (welcome visits, in-app usage)
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  path text,
  user_id uuid references auth.users(id) on delete set null,
  session_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_events_event_created_idx
  on public.product_events (event, created_at desc);

create index if not exists product_events_user_created_idx
  on public.product_events (user_id, created_at desc)
  where user_id is not null;

create index if not exists product_events_session_idx
  on public.product_events (session_id, created_at desc)
  where session_id is not null;

alter table public.product_events enable row level security;

-- Inserts go through service role API only; no public policies needed.
-- Authenticated users cannot read others' events (admin uses service client).
