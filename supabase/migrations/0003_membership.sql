-- World Cup 2026 — Two-Tier Membership Approval Gate (PR: friends-login fix)
--
-- Adds an approval gate on top of 0001 (rooms/room_members/bets) + 0002 (pools):
--   • App level  — super-admin (Brian) approves a user for the app at all.
--   • Room level — each room owner approves app-approved users into their room.
-- App approval is a precondition for joining any room; if app approval is
-- revoked, room access falls away automatically (the helpers cascade).
--
-- Security model follows the Supabase RLS checklist:
--   • SECURITY DEFINER helpers live in a non-exposed `private` schema, each
--     contains an auth.uid() check, and uses `set search_path = ''`.
--   • These helpers replace the self-referential subqueries of 0001/0002,
--     which both carried an infinite-recursion risk (never hit because the
--     tables were empty) — a definer function bypasses RLS, so no recursion.
--   • Every UPDATE policy has matching USING + WITH CHECK so a user can never
--     rewrite a row to escalate (e.g. self-approve).
-- Idempotent: safe to re-run.

-- ───────────── 1. private schema for SECURITY DEFINER helpers ─────────────
create schema if not exists private;
grant usage on schema private to authenticated;

-- ───────────── 2. profiles = app-level membership ─────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  app_status   text not null default 'pending'
                 check (app_status in ('pending','approved','rejected')),
  is_admin     boolean not null default false,
  requested_at timestamptz default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id)
);
alter table public.profiles enable row level security;

-- ───────────── 3. schema extensions on existing tables ─────────────
alter table public.rooms        add column if not exists owner_id uuid references auth.users(id);
alter table public.room_members add column if not exists status text not null default 'pending'
                                  check (status in ('pending','approved'));

-- ───────────── 4. helpers (definer, stable, locked search_path) ─────────────
create or replace function private.is_app_approved() returns boolean
  language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and app_status = 'approved');
$$;

create or replace function private.is_app_admin() returns boolean
  language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and is_admin = true);
$$;

create or replace function private.is_room_owner(rid uuid) returns boolean
  language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.rooms
                 where id = rid and owner_id = (select auth.uid()));
$$;

create or replace function private.is_room_member(rid uuid) returns boolean
  language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.room_members
                 where room_id = rid and user_id = (select auth.uid()) and status = 'approved');
$$;

create or replace function private.is_pool_member(pid uuid) returns boolean
  language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.pool_members
                 where pool_id = pid and user_id = (select auth.uid()));
$$;

-- ───────────── 5. auto-create a pending profile on signup ─────────────
create or replace function private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, app_status)
  values (new.id, new.email,
          nullif(new.raw_user_meta_data->>'display_name',''), 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ───────────── 6. backfill existing users + seed super-admin ─────────────
insert into public.profiles (id, email, app_status)
  select id, email, 'pending' from auth.users
  on conflict (id) do nothing;
update public.profiles
  set is_admin = true, app_status = 'approved', decided_at = now()
  where email = 'briannothdurft@icloud.com';

-- ───────────── 7. RLS: profiles ─────────────
drop policy if exists "profiles_select"       on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
-- self sees own row; admin sees all (admin needs SELECT to be able to UPDATE)
create policy "profiles_select" on public.profiles for select to authenticated
  using ( id = (select auth.uid()) or private.is_app_admin() );
-- only an admin may change status/is_admin — user can NOT self-approve
create policy "profiles_update_admin" on public.profiles for update to authenticated
  using ( private.is_app_admin() ) with check ( private.is_app_admin() );
-- no INSERT policy: rows are created by the (definer) signup trigger only

-- ───────────── 8. RLS: rooms ─────────────
drop policy if exists "see_own_rooms"       on public.rooms;
drop policy if exists "create_rooms"        on public.rooms;
drop policy if exists "lookup_room_by_code" on public.rooms;
drop policy if exists "rooms_select"        on public.rooms;
drop policy if exists "rooms_insert"        on public.rooms;
drop policy if exists "rooms_update"        on public.rooms;
-- owner + approved members see the room; any app-approved user may look a room
-- up by code (the code is the join secret) — but joining still needs approval
create policy "rooms_select" on public.rooms for select to authenticated
  using ( private.is_room_owner(id) or private.is_room_member(id) or private.is_app_approved() );
create policy "rooms_insert" on public.rooms for insert to authenticated
  with check ( private.is_app_approved() and owner_id = (select auth.uid()) );
create policy "rooms_update" on public.rooms for update to authenticated
  using ( private.is_room_owner(id) ) with check ( private.is_room_owner(id) );

-- ───────────── 9. RLS: room_members ─────────────
drop policy if exists "see_room_members"        on public.room_members;
drop policy if exists "join_self_to_room"       on public.room_members;
drop policy if exists "update_own_membership"   on public.room_members;
drop policy if exists "leave_own_room"          on public.room_members;
drop policy if exists "room_members_select"     on public.room_members;
drop policy if exists "room_members_join"       on public.room_members;
drop policy if exists "room_members_owner_self" on public.room_members;
drop policy if exists "room_members_owner_update" on public.room_members;
drop policy if exists "room_members_delete"     on public.room_members;
-- you always see your own membership; approved members + owner see the roster
create policy "room_members_select" on public.room_members for select to authenticated
  using ( user_id = (select auth.uid()) or private.is_room_member(room_id) or private.is_room_owner(room_id) );
-- join request: app-approved user adds *self* as pending
create policy "room_members_join" on public.room_members for insert to authenticated
  with check ( user_id = (select auth.uid()) and private.is_app_approved() and status = 'pending' );
-- owner adds self as approved on room creation
create policy "room_members_owner_self" on public.room_members for insert to authenticated
  with check ( user_id = (select auth.uid()) and private.is_room_owner(room_id) );
-- only the room owner may approve / change a membership row
create policy "room_members_owner_update" on public.room_members for update to authenticated
  using ( private.is_room_owner(room_id) ) with check ( private.is_room_owner(room_id) );
-- leave (self) or reject (owner)
create policy "room_members_delete" on public.room_members for delete to authenticated
  using ( user_id = (select auth.uid()) or private.is_room_owner(room_id) );

-- ───────────── 10. RLS: bets ─────────────
drop policy if exists "see_room_bets"   on public.bets;
drop policy if exists "see_own_bets"    on public.bets;
drop policy if exists "insert_own_bets" on public.bets;
drop policy if exists "update_own_bets" on public.bets;
drop policy if exists "bets_select"     on public.bets;
drop policy if exists "bets_insert"     on public.bets;
drop policy if exists "bets_update"     on public.bets;
create policy "bets_select" on public.bets for select to authenticated
  using ( user_id = (select auth.uid()) or (room_id is not null and private.is_room_member(room_id)) );
create policy "bets_insert" on public.bets for insert to authenticated
  with check ( user_id = (select auth.uid()) and (room_id is null or private.is_room_member(room_id)) );
create policy "bets_update" on public.bets for update to authenticated
  using ( user_id = (select auth.uid()) ) with check ( user_id = (select auth.uid()) );

-- ───────────── 11. RLS: pools ─────────────
drop policy if exists "see_own_pools"   on public.pools;
drop policy if exists "see_room_pools"  on public.pools;
drop policy if exists "create_pools"    on public.pools;
drop policy if exists "update_own_pool" on public.pools;
drop policy if exists "pools_select"    on public.pools;
drop policy if exists "pools_insert"    on public.pools;
drop policy if exists "pools_update"    on public.pools;
create policy "pools_select" on public.pools for select to authenticated
  using ( created_by = (select auth.uid()) or private.is_pool_member(id) or private.is_room_member(room_id) );
create policy "pools_insert" on public.pools for insert to authenticated
  with check ( created_by = (select auth.uid()) and private.is_room_member(room_id) );
create policy "pools_update" on public.pools for update to authenticated
  using ( created_by = (select auth.uid()) ) with check ( created_by = (select auth.uid()) );

-- ───────────── 12. RLS: pool_members ─────────────
drop policy if exists "see_pool_members"             on public.pool_members;
drop policy if exists "join_pools"                   on public.pool_members;
drop policy if exists "update_own_membership_pools"  on public.pool_members;
drop policy if exists "leave_pool"                   on public.pool_members;
drop policy if exists "pool_members_select"          on public.pool_members;
drop policy if exists "pool_members_join"            on public.pool_members;
drop policy if exists "pool_members_update"          on public.pool_members;
drop policy if exists "pool_members_delete"          on public.pool_members;
create policy "pool_members_select" on public.pool_members for select to authenticated
  using ( user_id = (select auth.uid()) or private.is_pool_member(pool_id) );
create policy "pool_members_join" on public.pool_members for insert to authenticated
  with check ( user_id = (select auth.uid())
               and exists (select 1 from public.pools p
                           where p.id = pool_id and private.is_room_member(p.room_id)) );
-- self manages own buy-in; pool creator manages members (settlement)
create policy "pool_members_update" on public.pool_members for update to authenticated
  using ( user_id = (select auth.uid())
          or exists (select 1 from public.pools p where p.id = pool_id and p.created_by = (select auth.uid())) )
  with check ( user_id = (select auth.uid())
          or exists (select 1 from public.pools p where p.id = pool_id and p.created_by = (select auth.uid())) );
create policy "pool_members_delete" on public.pool_members for delete to authenticated
  using ( user_id = (select auth.uid()) );

-- ───────────── 13. RLS: pool_predictions ─────────────
drop policy if exists "see_pool_predictions"   on public.pool_predictions;
drop policy if exists "insert_own_predictions" on public.pool_predictions;
drop policy if exists "update_own_predictions" on public.pool_predictions;
drop policy if exists "pool_predictions_select" on public.pool_predictions;
drop policy if exists "pool_predictions_insert" on public.pool_predictions;
drop policy if exists "pool_predictions_update" on public.pool_predictions;
create policy "pool_predictions_select" on public.pool_predictions for select to authenticated
  using ( user_id = (select auth.uid()) or private.is_pool_member(pool_id) );
create policy "pool_predictions_insert" on public.pool_predictions for insert to authenticated
  with check ( user_id = (select auth.uid()) and private.is_pool_member(pool_id) );
create policy "pool_predictions_update" on public.pool_predictions for update to authenticated
  using ( user_id = (select auth.uid()) ) with check ( user_id = (select auth.uid()) );

-- ───────────── 14. RLS: payment_handles ─────────────
drop policy if exists "see_room_handles"        on public.payment_handles;
drop policy if exists "manage_own_handles"      on public.payment_handles;
drop policy if exists "payment_handles_select"  on public.payment_handles;
drop policy if exists "payment_handles_manage"  on public.payment_handles;
-- visible to approved room-mates so they can pay you
create policy "payment_handles_select" on public.payment_handles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.room_members rm1
      join public.room_members rm2 on rm1.room_id = rm2.room_id
      where rm1.user_id = payment_handles.user_id and rm1.status = 'approved'
        and rm2.user_id = (select auth.uid())     and rm2.status = 'approved'
    )
  );
create policy "payment_handles_manage" on public.payment_handles for all to authenticated
  using ( user_id = (select auth.uid()) ) with check ( user_id = (select auth.uid()) );

-- ───────────── 15. realtime: publish profiles (idempotent) ─────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
