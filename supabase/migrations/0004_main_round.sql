-- World Cup 2026 — Collapse rooms into ONE global "main round" (PR: simplify)
--
-- Brian's decision: one shared round for everyone, he approves who joins (1 click).
-- Instead of ripping out the room system, we designate a single "main round"
-- (= his existing room ZVC6AS, keeping its pool + champion tip). Every
-- app-approved user automatically becomes an approved member of it, so the
-- room-code / join / owner-approval flow disappears and everyone sees everyone.
-- Idempotent.

-- ───────────── 1. is_main flag + designate the main round ─────────────
alter table public.rooms add column if not exists is_main boolean not null default false;
update public.rooms set is_main = true where code = 'ZVC6AS';

-- ───────────── 2. Backfill: every approved profile joins the main round ─────────────
insert into public.room_members (room_id, user_id, status, nickname)
select r.id, p.id, 'approved',
       coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1), left(p.id::text, 8))
from public.rooms r
cross join public.profiles p
where r.is_main = true and p.app_status = 'approved'
on conflict (room_id, user_id) do nothing;

-- ───────────── 3. Auto-join trigger: app_status → 'approved' ⇒ join main round ─────────────
create or replace function private.join_main_round() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare mid uuid;
begin
  if new.app_status = 'approved' and (old.app_status is distinct from 'approved') then
    select id into mid from public.rooms where is_main = true limit 1;
    if mid is not null then
      insert into public.room_members (room_id, user_id, status, nickname)
      values (mid, new.id, 'approved',
              coalesce(nullif(new.display_name, ''), split_part(coalesce(new.email, ''), '@', 1), left(new.id::text, 8)))
      on conflict (room_id, user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists on_profile_approved on public.profiles;
create trigger on_profile_approved after update of app_status on public.profiles
  for each row execute function private.join_main_round();

-- ───────────── 4. RLS: everyone in the round sees ALL tips (not just own pool) ─────────────
-- Extend pool_members + pool_predictions SELECT so any approved member of the
-- pool's room can read them — that's the "jeder sieht jeden" social hook.
drop policy if exists "pool_members_select" on public.pool_members;
create policy "pool_members_select" on public.pool_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_pool_member(pool_id)
    or private.is_room_member((select room_id from public.pools where id = pool_id))
  );

drop policy if exists "pool_predictions_select" on public.pool_predictions;
create policy "pool_predictions_select" on public.pool_predictions for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_pool_member(pool_id)
    or private.is_room_member((select room_id from public.pools where id = pool_id))
  );

-- ───────────── 5. Cleanup: drop the empty junk rooms from earlier testing ─────────────
delete from public.rooms
where code in ('4WCQBW', '65W73R')
  and not exists (select 1 from public.pools pl where pl.room_id = rooms.id)
  and not exists (select 1 from public.room_members rm where rm.room_id = rooms.id);
