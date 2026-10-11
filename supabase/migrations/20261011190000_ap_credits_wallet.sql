-- AP Credits wallet + ledger (non-expiring production capacity)

create table if not exists public.credit_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_purchased integer not null default 0 check (lifetime_purchased >= 0),
  lifetime_spent integer not null default 0 check (lifetime_spent >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  entry_type text not null,
  idempotency_key text not null,
  reference text,
  project_id uuid,
  job_id text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_ledger_idempotency unique (idempotency_key)
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;

create policy "credit_wallets_select_own" on public.credit_wallets
  for select using (auth.uid() = user_id);

create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- Writes only via service role (API); no insert/update policies for authenticated.
