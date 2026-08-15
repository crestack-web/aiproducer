-- Extend profiles for onboarding fields
alter table public.profiles
  add column if not exists role text,
  add column if not exists genre text,
  add column if not exists experience_level text,
  add column if not exists onboarding_completed_at timestamptz;
