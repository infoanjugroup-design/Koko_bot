-- ============================================================================
-- Koko WhatsApp Coin Bot — Supabase Schema
-- Tables: sessions (Baileys auth state), users, transactions
-- Run this once in the Supabase SQL editor before starting the bot.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. sessions — stores Baileys multi-device auth state (creds + signal keys)
--    so login survives Render free-tier restarts/redeploys (which wipe disk).
--    One row per (session_id, key) — e.g. ('default-session', 'creds'),
--    ('default-session', 'pre-key-1'), ('default-session', 'app-state-sync-key-...').
-- ----------------------------------------------------------------------------
create table if not exists public.sessions (
  session_id text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, key)
);

alter table public.sessions enable row level security;
-- No policies added on purpose: only the service_role key (used server-side
-- by the bot, which bypasses RLS) can read/write this table.

-- ----------------------------------------------------------------------------
-- 2. users — one row per WhatsApp number
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  coins integer not null default 0,
  signup_bonus_claimed boolean not null default false,
  last_daily_at timestamptz,
  quiz_state jsonb,               -- {"index": 0, "score": 0} while a quiz is active, else null
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- ----------------------------------------------------------------------------
-- 3. transactions — audit log of every coin movement
-- ----------------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null,
  type text not null,             -- signup_bonus | daily_checkin | quiz_correct
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_id on public.transactions(user_id);

alter table public.transactions enable row level security;

-- ----------------------------------------------------------------------------
-- 4. add_user_coins — atomic balance update + audit row in one statement,
--    so two messages arriving close together (e.g. a fast quiz double-tap)
--    can't race each other and lose a coin update.
-- ----------------------------------------------------------------------------
create or replace function public.add_user_coins(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_description text default null
)
returns integer
language plpgsql
as $$
declare
  v_new_balance integer;
begin
  update public.users
  set coins = coins + p_amount
  where id = p_user_id
  returning coins into v_new_balance;

  if v_new_balance is null then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.transactions (user_id, amount, type, description)
  values (p_user_id, p_amount, p_type, p_description);

  return v_new_balance;
end;
$$;
