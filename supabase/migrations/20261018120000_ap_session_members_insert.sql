-- Fix: allow session membership inserts required for invites / join
-- Without INSERT policies, owners never got a member row → createInvite returned 403.

create policy "ap_session_members_insert_self_or_owner"
on public.ap_session_members
for insert
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.ap_sessions s
    where s.id = session_id and s.created_by = auth.uid()
  )
  or public.ap_session_role_of(session_id) in ('owner', 'producer')
);

-- Events: allow members (and session creator) to insert audit rows
create policy "ap_session_events_insert_member"
on public.ap_session_events
for insert
with check (
  public.is_ap_session_member(session_id)
  or exists (
    select 1 from public.ap_sessions s
    where s.id = session_id and s.created_by = auth.uid()
  )
);
