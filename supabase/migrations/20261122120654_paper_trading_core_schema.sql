-- DRAFT ONLY — do not apply until migration review and explicit approval.
-- ZENURA IGNITE Paper Trading: schema aligned to the inspected Firebase gateway
-- transaction contracts on integration/paper-trading-backend-main-2026-11-20.
-- Money is integer paise. One shared INR virtual-cash account is used by Delivery,
-- Intraday and supported long CE/PE option simulation. No live broker orders.
-- Firebase UIDs are strings; never cast them to Supabase Auth UUIDs.

create table if not exists public.paper_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR' check (currency = 'INR'),
  starting_cash_paise bigint not null default 100000000 check (starting_cash_paise > 0),
  cash_paise bigint not null default 100000000 check (cash_paise >= 0),
  reserved_cash_paise bigint not null default 0 check (reserved_cash_paise >= 0),
  reserved_margin_paise bigint not null default 0 check (reserved_margin_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  delivery_realized_pnl_paise bigint not null default 0,
  intraday_realized_pnl_paise bigint not null default 0,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_accounts_reserves_within_cash
    check (reserved_cash_paise + reserved_margin_paise <= cash_paise)
);

create table if not exists public.paper_equity_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product in ('DELIVERY','INTRADAY')),
  instrument_key text not null check (length(instrument_key) between 1 and 100),
  trading_symbol text,
  exchange text,
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  average_price_paise bigint not null check (average_price_paise > 0),
  cost_basis_paise bigint not null check (cost_basis_paise > 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, product, instrument_key),
  constraint paper_equity_reserved_not_over_held check (reserved_quantity <= quantity)
);

create table if not exists public.paper_derivative_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null check (length(instrument_key) between 1 and 100),
  trading_symbol text,
  segment text,
  exchange text check (exchange is null or exchange in ('NSE','BSE')),
  instrument_type text not null check (instrument_type in ('CE','PE')),
  expiry date,
  lot_size integer check (lot_size is null or lot_size > 0),
  net_quantity integer not null check (net_quantity > 0 and net_quantity <= 1000000),
  average_price_paise bigint not null check (average_price_paise > 0),
  cost_basis_paise bigint not null check (cost_basis_paise > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, instrument_key)
);

create table if not exists public.paper_orders (
  order_id text primary key check (order_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  instrument_key text not null,
  trading_symbol text,
  exchange text,
  side text not null check (side in ('BUY','SELL')),
  product text not null default 'DELIVERY' check (product in ('DELIVERY','INTRADAY')),
  order_type text not null check (order_type in ('MARKET','LIMIT')),
  status text not null check (status in ('PENDING','FILLED','CANCELLED','REJECTED')),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  limit_price_paise bigint check (limit_price_paise is null or limit_price_paise > 0),
  execution_price_paise bigint check (execution_price_paise is null or execution_price_paise > 0),
  gross_paise bigint check (gross_paise is null or gross_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  reserved_cash_paise bigint not null default 0 check (reserved_cash_paise >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  quote_timestamp_ms bigint,
  quote_age_ms bigint,
  reservation_released boolean not null default false,
  worker_execution boolean not null default false,
  cancelled_at timestamptz,
  filled_at timestamptz,
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_limit_order_requires_price
    check (order_type <> 'LIMIT' or limit_price_paise is not null),
  constraint paper_intraday_limit_not_enabled
    check (order_type <> 'LIMIT' or product = 'DELIVERY')
);

create table if not exists public.paper_derivative_orders (
  order_id text primary key check (order_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  instrument_key text not null,
  trading_symbol text,
  exchange text,
  segment text,
  instrument_type text not null check (instrument_type in ('CE','PE')),
  expiry date,
  -- Nullable only for legacy imported rows; new option RPC fills this immutable contract field.
  strike_price numeric check (strike_price is null or (strike_price > 0 and strike_price::text not in ('NaN','Infinity','-Infinity'))),
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  lots integer not null check (lots > 0),
  lot_size integer not null check (lot_size > 0),
  order_type text not null default 'MARKET' check (order_type = 'MARKET'),
  status text not null default 'FILLED' check (status in ('FILLED','REJECTED')),
  execution_price_paise bigint not null check (execution_price_paise > 0),
  quote_timestamp_ms bigint not null,
  quote_age_ms bigint not null check (quote_age_ms >= 0),
  gross_paise bigint not null check (gross_paise > 0),
  charges_paise bigint not null default 0 check (charges_paise >= 0),
  total_debit_paise bigint check (total_debit_paise is null or total_debit_paise >= 0),
  -- SELL net credit may be negative when indicative charges exceed tiny premium turnover.
  net_credit_paise bigint,
  realized_pnl_paise bigint not null default 0,
  cash_delta_paise bigint not null,
  charges_breakdown jsonb not null default '{}'::jsonb,
  excludes_charges boolean not null default false,
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now()
);

create table if not exists public.paper_watchlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name in ('My Stocks','Banking','NIFTY','F&O')),
  instrument_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, name),
  constraint paper_watchlists_max_50 check (cardinality(instrument_keys) <= 50)
);

-- AES-256-GCM envelope is JSON {v,iv,tag,data}; key remains server-side.
create table if not exists public.upstox_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('connected','disconnected')),
  token_ciphertext jsonb not null,
  token_type text not null default 'Bearer',
  provider text not null default 'upstox' check (provider = 'upstox'),
  token_expires_at timestamptz not null,
  token_issued_at timestamptz,
  authorized_at timestamptz,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.upstox_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_generation bigint not null default 0 check (connection_generation >= 0),
  used boolean not null default false,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.upstox_connection_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation bigint not null default 0 check (generation >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0)
);

create table if not exists public.paper_market_stream_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lease_id uuid not null,
  expires_at_ms bigint not null check (expires_at_ms >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  revoked boolean not null default false
);

create table if not exists public.paper_market_worker_state (
  state_key text primary key,
  cursor_order_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_margin_preview_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_requested_at_ms bigint not null check (last_requested_at_ms >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0)
);

create unique index if not exists paper_orders_user_idempotency_idx
  on public.paper_orders (user_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists paper_derivative_orders_user_idempotency_idx
  on public.paper_derivative_orders (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists paper_orders_user_created_idx
  on public.paper_orders (user_id, created_at desc, order_id desc);
create index if not exists paper_orders_user_status_idx
  on public.paper_orders (user_id, status, created_at desc);
create index if not exists paper_orders_pending_worker_idx
  on public.paper_orders (created_at asc, order_id asc)
  where order_type = 'LIMIT' and status = 'PENDING';
create index if not exists paper_derivative_orders_user_created_idx
  on public.paper_derivative_orders (user_id, created_at desc, order_id desc);
create index if not exists paper_equity_positions_user_product_idx
  on public.paper_equity_positions (user_id, product);
create index if not exists paper_derivative_positions_user_idx
  on public.paper_derivative_positions (user_id);
create index if not exists upstox_oauth_states_expiry_idx
  on public.upstox_oauth_states (expires_at);
create index if not exists paper_market_stream_leases_expiry_idx
  on public.paper_market_stream_leases (expires_at_ms);


-- New users authenticate directly with Supabase Auth; auth.uid() is the canonical owner UUID.
-- Every table has RLS. Trading writes and all provider/worker state are server-only.
alter table public.paper_accounts enable row level security;
alter table public.paper_equity_positions enable row level security;
alter table public.paper_derivative_positions enable row level security;
alter table public.paper_orders enable row level security;
alter table public.paper_derivative_orders enable row level security;
alter table public.paper_watchlists enable row level security;
alter table public.upstox_connections enable row level security;
alter table public.upstox_oauth_states enable row level security;
alter table public.upstox_connection_controls enable row level security;
alter table public.paper_market_stream_leases enable row level security;
alter table public.paper_market_worker_state enable row level security;
alter table public.paper_margin_preview_limits enable row level security;

drop policy if exists paper_accounts_select_own on public.paper_accounts;
create policy paper_accounts_select_own on public.paper_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_equity_positions_select_own on public.paper_equity_positions;
create policy paper_equity_positions_select_own on public.paper_equity_positions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_derivative_positions_select_own on public.paper_derivative_positions;
create policy paper_derivative_positions_select_own on public.paper_derivative_positions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_orders_select_own on public.paper_orders;
create policy paper_orders_select_own on public.paper_orders
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_derivative_orders_select_own on public.paper_derivative_orders;
create policy paper_derivative_orders_select_own on public.paper_derivative_orders
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_watchlists_select_own on public.paper_watchlists;
create policy paper_watchlists_select_own on public.paper_watchlists
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists paper_watchlists_insert_own on public.paper_watchlists;
create policy paper_watchlists_insert_own on public.paper_watchlists
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists paper_watchlists_update_own on public.paper_watchlists;
create policy paper_watchlists_update_own on public.paper_watchlists
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists paper_watchlists_delete_own on public.paper_watchlists;
create policy paper_watchlists_delete_own on public.paper_watchlists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Sensitive tables have no authenticated/anon grants or user policies.
revoke all on public.paper_accounts,
  public.paper_equity_positions, public.paper_derivative_positions,
  public.paper_orders, public.paper_derivative_orders, public.paper_watchlists,
  public.upstox_connections, public.upstox_oauth_states,
  public.upstox_connection_controls, public.paper_market_stream_leases,
  public.paper_market_worker_state, public.paper_margin_preview_limits
  from anon, authenticated;

grant select on public.paper_accounts, public.paper_equity_positions,
  public.paper_derivative_positions, public.paper_orders,
  public.paper_derivative_orders, public.paper_watchlists
  to authenticated;
grant insert, update, delete on public.paper_watchlists to authenticated;
