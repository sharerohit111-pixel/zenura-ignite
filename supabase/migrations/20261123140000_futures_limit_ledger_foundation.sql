-- Draft-only Futures LIMIT ledger foundation.
-- This migration deliberately does not add submit/fill/cancel RPCs, grant worker
-- execution, enable a worker, or enable Futures LIMIT in the application.
-- Apply only in disposable PostgreSQL CI until the complete lifecycle is tested.

alter table public.paper_futures_orders
  add column if not exists filled_quantity integer not null default 0,
  add column if not exists remaining_quantity integer not null default 0,
  add column if not exists average_fill_price_paise bigint,
  add column if not exists reserved_open_margin_paise bigint not null default 0,
  add column if not exists reserved_close_quantity integer not null default 0,
  add column if not exists expires_at timestamptz;

-- Existing MARKET rows are terminal and have no pending quantity reservation.
-- LIMIT rows are still non-executable until the complete RPC lifecycle is added.
update public.paper_futures_orders
   set filled_quantity=case when status='FILLED' then quantity else 0 end,
       remaining_quantity=case when status='FILLED' then 0 else quantity end,
       average_fill_price_paise=execution_price_paise,
       reserved_open_margin_paise=0,
       reserved_close_quantity=0
 where filled_quantity=0 and remaining_quantity=0
   and reserved_open_margin_paise=0 and reserved_close_quantity=0;

alter table public.paper_futures_orders
  drop constraint if exists paper_futures_orders_status_check;
alter table public.paper_futures_orders
  add constraint paper_futures_orders_status_check
  check (status in ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','REJECTED'));

alter table public.paper_futures_orders
  drop constraint if exists paper_futures_order_fill_quantities_check;
alter table public.paper_futures_orders
  add constraint paper_futures_order_fill_quantities_check
  check (
    filled_quantity between 0 and quantity
    and remaining_quantity between 0 and quantity
    -- Existing MARKET RPCs predate these LIMIT-only tracking fields and do not
    -- populate them. Preserve their established write contract; enforce exact
    -- quantity conservation for LIMIT rows, whose lifecycle will use these fields.
    and (order_type = 'MARKET' or filled_quantity + remaining_quantity = quantity)
    and reserved_open_margin_paise >= 0
    and reserved_close_quantity >= 0
    and reserved_close_quantity <= remaining_quantity
    and (average_fill_price_paise is null or average_fill_price_paise > 0)
  );

alter table public.paper_futures_positions
  add column if not exists reserved_close_quantity integer not null default 0;

alter table public.paper_futures_positions
  drop constraint if exists paper_futures_positions_reserved_close_quantity_check;
alter table public.paper_futures_positions
  add constraint paper_futures_positions_reserved_close_quantity_check
  check (reserved_close_quantity >= 0 and reserved_close_quantity <= abs(net_quantity));

create index if not exists paper_futures_limit_expiry_idx
  on public.paper_futures_orders(expires_at,created_at,order_id)
  where order_type='LIMIT' and status in ('PENDING','PARTIALLY_FILLED');

create table if not exists public.paper_futures_fills (
  fill_id uuid primary key default gen_random_uuid(),
  order_id text not null references public.paper_futures_orders(order_id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  execution_id text not null check (length(execution_id) between 1 and 160),
  fill_sequence integer not null check (fill_sequence > 0),
  quantity integer not null check (quantity > 0),
  execution_price_paise bigint not null check (execution_price_paise > 0),
  gross_paise bigint not null check (gross_paise > 0),
  allocated_margin_paise bigint not null default 0 check (allocated_margin_paise >= 0),
  charges_paise bigint not null default 0 check (charges_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  quote_timestamp_ms bigint not null check (quote_timestamp_ms > 0),
  filled_at timestamptz not null default now(),
  simulation_only boolean not null default true check (simulation_only is true),
  unique(order_id,execution_id),
  unique(order_id,fill_sequence)
);

create index if not exists paper_futures_fills_user_filled_idx
  on public.paper_futures_fills(user_id,filled_at desc,fill_id);

alter table public.paper_futures_fills enable row level security;
revoke all on public.paper_futures_fills from public,anon,authenticated;
grant select,insert,update,delete on public.paper_futures_fills to service_role;

comment on table public.paper_futures_fills is
  'Private append-only-by-contract simulation fill ledger. Writes must be performed only by a future atomic service-role fill RPC; no direct client access.';
comment on column public.paper_futures_orders.reserved_open_margin_paise is
  'Unconsumed opening-margin reservation for the unfilled LIMIT remainder; must reconcile with paper_accounts reserved_margin_paise.';
comment on column public.paper_futures_orders.reserved_close_quantity is
  'Close-only quantity reserved against the signed position for the unfilled LIMIT remainder.';
