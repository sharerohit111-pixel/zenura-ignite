-- DRAFT ONLY. Dedicated NSE long-options LIMIT schema; no order routing is enabled.
-- Preserve the MARKET-only receipt ledger. LIMIT lifecycle writes remain service-role RPC-only.

alter table public.paper_derivative_positions
  add column if not exists reserved_quantity integer not null default 0
    check (reserved_quantity >= 0);

do $reservation_guard$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.paper_derivative_positions'::regclass
       and conname='paper_derivative_positions_reserved_not_over_held'
  ) then
    alter table public.paper_derivative_positions
      add constraint paper_derivative_positions_reserved_not_over_held
      check (reserved_quantity <= net_quantity);
  end if;
end
$reservation_guard$;

-- Existing MARKET SELL must not consume quantity reserved by an outstanding LIMIT close.
do $market_sell_patch$
declare
  v_signature regprocedure :=
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text := $old$if p_side='SELL' and (not v_has_position or v_old_qty<v_quantity) then$old$;
  v_new text := $new$if p_side='SELL' and (not v_has_position or v_old_qty-coalesce(v_position.reserved_quantity,0)<v_quantity) then$new$;
begin
  v_definition := pg_get_functiondef(v_signature);
  if position(v_new in v_definition)>0 then
    return;
  end if;
  if position(v_old in v_definition)=0 then
    raise exception 'Expected MARKET SELL availability guard was not found exactly as designed';
  end if;
  v_patched := replace(v_definition,v_old,v_new);
  if v_patched=v_definition or position(v_new in v_patched)=0 then
    raise exception 'Could not safely patch MARKET SELL reserved-quantity guard';
  end if;
  execute v_patched;
end
$market_sell_patch$;

create table if not exists public.paper_option_limit_orders (
  order_id text primary key check (order_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  instrument_key text not null check (length(instrument_key) between 1 and 160),
  trading_symbol text not null check (length(trading_symbol) between 1 and 80),
  exchange text not null check (exchange = 'NSE'),
  segment text not null check (segment = 'NSE_FO'),
  instrument_type text not null check (instrument_type in ('CE','PE')),
  expiry date not null,
  strike_price numeric not null check (
    strike_price > 0 and strike_price::text not in ('NaN','Infinity','-Infinity')
  ),
  lot_size integer not null check (lot_size between 1 and 1000000),
  tick_size_paise integer not null check (tick_size_paise between 1 and 1000000),
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity between 1 and 1000000),
  filled_quantity integer not null default 0 check (filled_quantity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  limit_price_paise bigint not null check (limit_price_paise > 0),
  average_fill_price_paise bigint check (average_fill_price_paise is null or average_fill_price_paise > 0),
  cumulative_gross_paise bigint not null default 0 check (cumulative_gross_paise >= 0),
  cumulative_charges_paise bigint not null default 0 check (cumulative_charges_paise >= 0),
  reserved_cash_paise bigint not null default 0 check (reserved_cash_paise >= 0),
  reserved_close_quantity integer not null default 0 check (reserved_close_quantity >= 0),
  status text not null default 'PENDING'
    check (status in ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','REJECTED')),
  expires_at timestamptz not null,
  reservation_released boolean not null default false,
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_option_limit_quantity_conserved
    check (filled_quantity + remaining_quantity = quantity),
  constraint paper_option_limit_lot_multiple
    check (quantity % lot_size = 0),
  constraint paper_option_limit_tick_aligned
    check (limit_price_paise % tick_size_paise = 0),
  constraint paper_option_limit_side_reservation
    check (
      (side='BUY' and reserved_close_quantity=0)
      or (side='SELL' and reserved_cash_paise=0)
    ),
  constraint paper_option_limit_terminal_reservation
    check (
      (status in ('PENDING','PARTIALLY_FILLED'))
      or (reserved_cash_paise=0 and reserved_close_quantity=0)
    ),
  constraint paper_option_limit_fill_state
    check (
      (status='PENDING' and filled_quantity=0)
      or (status='PARTIALLY_FILLED' and filled_quantity>0 and remaining_quantity>0)
      or (status='FILLED' and filled_quantity=quantity and remaining_quantity=0)
      or status in ('CANCELLED','EXPIRED','REJECTED')
    ),
  constraint paper_option_limit_reservation_release_state
    check (
      (status in ('CANCELLED','EXPIRED','REJECTED','FILLED') and reservation_released)
      or (status in ('PENDING','PARTIALLY_FILLED') and not reservation_released)
    )
);

create unique index if not exists paper_option_limit_orders_user_idempotency_uidx
  on public.paper_option_limit_orders(user_id,idempotency_key);
create index if not exists paper_option_limit_orders_worker_scan_idx
  on public.paper_option_limit_orders(created_at,order_id)
  where status in ('PENDING','PARTIALLY_FILLED') and simulation_only is true;
create index if not exists paper_option_limit_orders_user_history_idx
  on public.paper_option_limit_orders(user_id,created_at desc,order_id);

create table if not exists public.paper_option_limit_fills (
  fill_id bigint generated always as identity primary key,
  order_id text not null references public.paper_option_limit_orders(order_id) on delete restrict,
  execution_id text not null check (length(execution_id) between 1 and 160),
  fill_sequence integer not null check (fill_sequence > 0),
  fill_quantity integer not null check (fill_quantity > 0),
  execution_price_paise bigint not null check (execution_price_paise > 0),
  gross_paise bigint not null check (gross_paise > 0),
  incremental_charges_paise bigint not null check (incremental_charges_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  bid_price_paise bigint not null check (bid_price_paise > 0),
  bid_quantity integer not null check (bid_quantity > 0),
  ask_price_paise bigint not null check (ask_price_paise > 0),
  ask_quantity integer not null check (ask_quantity > 0),
  quote_timestamp_ms bigint not null check (quote_timestamp_ms > 0),
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  constraint paper_option_limit_fill_order_execution_uidx unique(order_id,execution_id),
  constraint paper_option_limit_fill_order_sequence_uidx unique(order_id,fill_sequence)
);

alter table public.paper_option_limit_orders enable row level security;
alter table public.paper_option_limit_fills enable row level security;

drop policy if exists paper_option_limit_orders_select_own
  on public.paper_option_limit_orders;
create policy paper_option_limit_orders_select_own
  on public.paper_option_limit_orders for select to authenticated
  using (user_id=auth.uid());

drop policy if exists paper_option_limit_fills_select_own
  on public.paper_option_limit_fills;
create policy paper_option_limit_fills_select_own
  on public.paper_option_limit_fills for select to authenticated
  using (exists (
    select 1 from public.paper_option_limit_orders o
     where o.order_id=paper_option_limit_fills.order_id
       and o.user_id=auth.uid()
  ));

revoke all on public.paper_option_limit_orders,public.paper_option_limit_fills
  from public,anon,authenticated;
grant select on public.paper_option_limit_orders,public.paper_option_limit_fills
  to authenticated;
grant select,insert,update,delete on public.paper_option_limit_orders
  to service_role;
grant select,insert on public.paper_option_limit_fills
  to service_role;
grant usage,select on sequence public.paper_option_limit_fills_fill_id_seq
  to service_role;

revoke all on function public.execute_paper_long_option_order(
  uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint
) from public,anon,authenticated;
