-- Align ap_session_invites with app code when table was created without usage columns
alter table public.ap_session_invites
  add column if not exists max_uses int not null default 20;

alter table public.ap_session_invites
  add column if not exists use_count int not null default 0;
