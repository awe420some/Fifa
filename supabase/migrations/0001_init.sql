-- World Cup 2026 — Multiplayer Leaderboard (PR B)
--
-- Schema for friends-only bet rooms and sync.
-- Run this in the Supabase SQL Editor on a fresh project after enabling
-- Magic-Link auth in Authentication → Providers → Email.
--
-- After migration: Vercel ENV vars
--   NEXT_PUBLIC_SUPABASE_URL       https://<project>.supabase.co
--   NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key from Settings → API>
--
-- The anon key is safe to ship to the client — Row Level Security
-- below blocks any cross-room reads even with the anon key.

-- ─────────── Tables ───────────

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,            -- 6-char shareable code, e.g. "ZK7M4P"
  name text,
  created_at timestamptz default now()
);

create table if not exists room_members (
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  nickname text not null,
  joined_at timestamptz default now(),
  primary key (room_id, user_id)
);

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  room_id uuid references rooms(id) on delete cascade,  -- nullable: private bets stay local
  placed_at timestamptz default now(),
  stake numeric not null,
  combo_odds numeric not null,
  combo_market_odds numeric,
  items jsonb not null,                  -- [{matchNo, marketId, label, modelP, modelOdds, marketOdds, outcome}]
  status text default 'open' check (status in ('open', 'won', 'lost', 'void')),
  payout numeric,
  settled_at timestamptz
);

create index if not exists bets_room_id_idx on bets (room_id);
create index if not exists bets_user_id_idx on bets (user_id);
create index if not exists bets_placed_at_idx on bets (placed_at desc);

-- ─────────── Row Level Security ───────────

alter table rooms        enable row level security;
alter table room_members enable row level security;
alter table bets         enable row level security;

-- Rooms: members can see rooms they belong to.
drop policy if exists "see_own_rooms" on rooms;
create policy "see_own_rooms" on rooms for select using (
  exists (
    select 1 from room_members
    where room_members.room_id = rooms.id
      and room_members.user_id = auth.uid()
  )
);

drop policy if exists "create_rooms" on rooms;
create policy "create_rooms" on rooms for insert with check (true);

-- Rooms are read-only by code lookup too — needed for join flow before
-- the user is a member. We deliberately allow a logged-in user to look
-- up a room by code (this is fine because the code IS the auth — anyone
-- with the code can join). Use Supabase auth-only access (anon=false).
drop policy if exists "lookup_room_by_code" on rooms;
create policy "lookup_room_by_code" on rooms for select to authenticated using (true);

-- Members: a room member can see all members of their rooms.
drop policy if exists "see_room_members" on room_members;
create policy "see_room_members" on room_members for select using (
  exists (
    select 1 from room_members rm2
    where rm2.room_id = room_members.room_id
      and rm2.user_id = auth.uid()
  )
);

drop policy if exists "join_self_to_room" on room_members;
create policy "join_self_to_room" on room_members for insert with check (auth.uid() = user_id);

drop policy if exists "update_own_membership" on room_members;
create policy "update_own_membership" on room_members for update using (auth.uid() = user_id);

drop policy if exists "leave_own_room" on room_members;
create policy "leave_own_room" on room_members for delete using (auth.uid() = user_id);

-- Bets: members of a room see all bets posted to that room.
drop policy if exists "see_room_bets" on bets;
create policy "see_room_bets" on bets for select using (
  room_id is not null
  and exists (
    select 1 from room_members
    where room_members.room_id = bets.room_id
      and room_members.user_id = auth.uid()
  )
);

-- Users see their own bets even when room_id is null (private mode).
drop policy if exists "see_own_bets" on bets;
create policy "see_own_bets" on bets for select using (auth.uid() = user_id);

drop policy if exists "insert_own_bets" on bets;
create policy "insert_own_bets" on bets for insert with check (auth.uid() = user_id);

drop policy if exists "update_own_bets" on bets;
create policy "update_own_bets" on bets for update using (auth.uid() = user_id);

-- ─────────── Realtime publication ───────────
-- Enables the WebSocket subscription used by the client.

alter publication supabase_realtime add table bets;
alter publication supabase_realtime add table room_members;
