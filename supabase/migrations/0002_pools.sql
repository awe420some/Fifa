-- World Cup 2026 — Wett-Pools mit Real-Stake-Tracking (PR C)
--
-- Builds on 0001_init.sql (rooms, room_members, bets). Run AFTER
-- 0001 in the Supabase SQL Editor. Adds three pool types (P&L race,
-- bracket, closest-to-pin), per-member buy-in tracking with paid-via
-- deep-link reference, and pool predictions for the non-P&L types.

-- ─────────── Pools ───────────

create table if not exists pools (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  created_by uuid references auth.users(id) not null,
  name text not null,
  pool_type text not null check (pool_type in ('pnl', 'bracket', 'ctp')),
  buy_in numeric not null check (buy_in > 0),
  currency text default 'EUR',
  starts_at timestamptz default now(),
  ends_at timestamptz not null,
  status text default 'open' check (status in ('open', 'locked', 'settled')),
  winner_id uuid references auth.users(id),
  pot_total numeric default 0,
  created_at timestamptz default now()
);

create index if not exists pools_room_id_idx on pools (room_id);

-- ─────────── Pool members ───────────

create table if not exists pool_members (
  pool_id uuid references pools(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz default now(),
  buy_in_status text default 'pending' check (buy_in_status in ('pending', 'paid', 'waived')),
  paid_at timestamptz,
  paid_via text,  -- 'venmo' | 'paypal' | 'revolut' | 'sepa' | 'cash' | 'other'
  paid_to text,   -- handle / IBAN / etc. of who got paid
  score numeric default 0,  -- P&L / bracket points / CTP score
  primary key (pool_id, user_id)
);

-- ─────────── Pool predictions (bracket + CTP) ───────────

create table if not exists pool_predictions (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid references pools(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  pred_type text not null check (pred_type in ('champion', 'group_first', 'match_score')),
  match_no integer,
  prediction jsonb not null,
  points numeric default 0,
  settled_at timestamptz,
  unique (pool_id, user_id, pred_type, match_no)
);

-- ─────────── User payment handles (settings) ───────────

create table if not exists payment_handles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  venmo text,
  paypal text,
  revolut text,
  sepa_iban text,
  display_name text,
  updated_at timestamptz default now()
);

-- ─────────── RLS ───────────

alter table pools enable row level security;
alter table pool_members enable row level security;
alter table pool_predictions enable row level security;
alter table payment_handles enable row level security;

-- Pools: members can see pools they belong to.
drop policy if exists "see_own_pools" on pools;
create policy "see_own_pools" on pools for select using (
  exists (
    select 1 from pool_members
    where pool_members.pool_id = pools.id
      and pool_members.user_id = auth.uid()
  )
);

-- Members of the same room can see new pools (so they can join one).
drop policy if exists "see_room_pools" on pools;
create policy "see_room_pools" on pools for select using (
  exists (
    select 1 from room_members
    where room_members.room_id = pools.room_id
      and room_members.user_id = auth.uid()
  )
);

drop policy if exists "create_pools" on pools;
create policy "create_pools" on pools for insert with check (
  auth.uid() = created_by
  and exists (
    select 1 from room_members
    where room_members.room_id = pools.room_id
      and room_members.user_id = auth.uid()
  )
);

drop policy if exists "update_own_pool" on pools;
create policy "update_own_pool" on pools for update using (auth.uid() = created_by);

-- Pool members: visible to other members of the same pool
drop policy if exists "see_pool_members" on pool_members;
create policy "see_pool_members" on pool_members for select using (
  exists (
    select 1 from pool_members pm2
    where pm2.pool_id = pool_members.pool_id
      and pm2.user_id = auth.uid()
  )
);

drop policy if exists "join_pools" on pool_members;
create policy "join_pools" on pool_members for insert with check (
  auth.uid() = user_id
  and exists (
    select 1 from pools p
    join room_members rm on rm.room_id = p.room_id
    where p.id = pool_members.pool_id
      and rm.user_id = auth.uid()
  )
);

drop policy if exists "update_own_membership_pools" on pool_members;
create policy "update_own_membership_pools" on pool_members for update using (auth.uid() = user_id);

drop policy if exists "leave_pool" on pool_members;
create policy "leave_pool" on pool_members for delete using (auth.uid() = user_id);

-- Predictions: visible to fellow pool members; user manages their own.
drop policy if exists "see_pool_predictions" on pool_predictions;
create policy "see_pool_predictions" on pool_predictions for select using (
  exists (
    select 1 from pool_members
    where pool_members.pool_id = pool_predictions.pool_id
      and pool_members.user_id = auth.uid()
  )
);

drop policy if exists "insert_own_predictions" on pool_predictions;
create policy "insert_own_predictions" on pool_predictions for insert with check (auth.uid() = user_id);

drop policy if exists "update_own_predictions" on pool_predictions;
create policy "update_own_predictions" on pool_predictions for update using (auth.uid() = user_id);

-- Payment handles: visible to all room mates (so they can pay you)
drop policy if exists "see_room_handles" on payment_handles;
create policy "see_room_handles" on payment_handles for select using (
  exists (
    select 1 from room_members rm1
    join room_members rm2 on rm1.room_id = rm2.room_id
    where rm1.user_id = payment_handles.user_id
      and rm2.user_id = auth.uid()
  )
);

drop policy if exists "manage_own_handles" on payment_handles;
create policy "manage_own_handles" on payment_handles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────── Realtime ───────────

alter publication supabase_realtime add table pools;
alter publication supabase_realtime add table pool_members;
alter publication supabase_realtime add table pool_predictions;

-- ─────────── Pool helper: increment pot_total when a buy-in is marked paid ───────────

create or replace function bump_pot_total() returns trigger as $$
begin
  if (TG_OP = 'UPDATE' and NEW.buy_in_status = 'paid' and OLD.buy_in_status <> 'paid') then
    update pools
       set pot_total = pot_total + (select buy_in from pools where id = NEW.pool_id)
     where id = NEW.pool_id;
  elsif (TG_OP = 'UPDATE' and NEW.buy_in_status <> 'paid' and OLD.buy_in_status = 'paid') then
    update pools
       set pot_total = pot_total - (select buy_in from pools where id = NEW.pool_id)
     where id = NEW.pool_id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists pool_member_pot_total on pool_members;
create trigger pool_member_pot_total
  after update on pool_members
  for each row execute function bump_pot_total();
