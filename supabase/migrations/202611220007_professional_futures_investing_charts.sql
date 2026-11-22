-- Draft-only schema expansion for the professional ZENURA IGNITE launch.
-- No live Supabase database is changed by this repository migration.
-- Futures, investing, protective orders and chart workspaces are isolated per native Auth user.

create table if not exists public.paper_futures_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null check (length(instrument_key) between 1 and 100),
  trading_symbol text not null,
  exchange text not null check (exchange in ('NSE','BSE')),
  segment text not null check (segment in ('NSE_FO','BSE_FO')),
  expiry date not null,
  product text not null check (product in ('INTRADAY','DELIVERY')),
  lot_size integer not null check (lot_size > 0),
  tick_size_paise integer not null check (tick_size_paise > 0),
  net_quantity integer not null check (net_quantity <> 0 and abs(net_quantity) <= 1000000),
  average_price_paise bigint not null check (average_price_paise > 0),
  reserved_margin_paise bigint not null default 0 check (reserved_margin_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id,instrument_key)
);

create table if not exists public.paper_futures_orders (
  order_id text primary key check (order_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  instrument_key text not null,
  trading_symbol text not null,
  exchange text not null check (exchange in ('NSE','BSE')),
  segment text not null check (segment in ('NSE_FO','BSE_FO')),
  expiry date not null,
  lot_size integer not null check (lot_size > 0),
  side text not null check (side in ('BUY','SELL')),
  product text not null check (product in ('INTRADAY','DELIVERY')),
  order_type text not null check (order_type in ('MARKET','LIMIT')),
  status text not null check (status in ('PENDING','FILLED','CANCELLED','REJECTED')),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  limit_price_paise bigint check (limit_price_paise is null or limit_price_paise > 0),
  execution_price_paise bigint check (execution_price_paise is null or execution_price_paise > 0),
  margin_reserved_paise bigint not null default 0 check (margin_reserved_paise >= 0),
  charges_paise bigint not null default 0 check (charges_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  quote_timestamp_ms bigint,
  quote_age_ms bigint check (quote_age_ms is null or quote_age_ms >= 0),
  reservation_released boolean not null default false,
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  constraint paper_futures_limit_requires_price
    check (order_type <> 'LIMIT' or limit_price_paise is not null)
);

create unique index if not exists paper_futures_orders_user_idempotency_idx
  on public.paper_futures_orders(user_id,idempotency_key)
  where idempotency_key is not null;
create index if not exists paper_futures_orders_user_created_idx
  on public.paper_futures_orders(user_id,created_at desc,order_id desc);
create index if not exists paper_futures_orders_pending_idx
  on public.paper_futures_orders(created_at,order_id)
  where order_type='LIMIT' and status='PENDING';
create index if not exists paper_futures_positions_user_idx
  on public.paper_futures_positions(user_id,expiry);

-- Paper Investing is deliberately a separate ledger from active Paper Trading.
create table if not exists public.paper_investing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR' check (currency='INR'),
  starting_cash_paise bigint not null default 100000000 check (starting_cash_paise > 0),
  cash_paise bigint not null default 100000000 check (cash_paise >= 0),
  reserved_cash_paise bigint not null default 0 check (reserved_cash_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_investing_reserves_within_cash
    check (reserved_cash_paise <= cash_paise)
);

create table if not exists public.paper_investing_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null check (length(instrument_key) between 1 and 100),
  trading_symbol text not null,
  exchange text not null check (exchange in ('NSE','BSE')),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  average_price_paise bigint not null check (average_price_paise > 0),
  cost_basis_paise bigint not null check (cost_basis_paise > 0),
  realized_pnl_paise bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id,instrument_key)
);

create table if not exists public.paper_investing_orders (
  order_id text primary key check (order_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  instrument_key text not null,
  trading_symbol text not null,
  exchange text not null check (exchange in ('NSE','BSE')),
  side text not null check (side in ('BUY','SELL')),
  order_type text not null check (order_type in ('MARKET','LIMIT')),
  status text not null check (status in ('PENDING','FILLED','CANCELLED','REJECTED')),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  limit_price_paise bigint check (limit_price_paise is null or limit_price_paise > 0),
  execution_price_paise bigint check (execution_price_paise is null or execution_price_paise > 0),
  gross_paise bigint check (gross_paise is null or gross_paise >= 0),
  charges_paise bigint not null default 0 check (charges_paise >= 0),
  realized_pnl_paise bigint not null default 0,
  quote_timestamp_ms bigint,
  quote_age_ms bigint check (quote_age_ms is null or quote_age_ms >= 0),
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  constraint paper_investing_limit_requires_price
    check (order_type <> 'LIMIT' or limit_price_paise is not null)
);
create unique index if not exists paper_investing_orders_user_idempotency_idx
  on public.paper_investing_orders(user_id,idempotency_key)
  where idempotency_key is not null;
create index if not exists paper_investing_orders_user_created_idx
  on public.paper_investing_orders(user_id,created_at desc,order_id desc);
create index if not exists paper_investing_positions_user_idx
  on public.paper_investing_positions(user_id);

-- Server-evaluated protective orders. Client cannot directly trigger or fill these.
create table if not exists public.paper_protective_orders (
  order_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_class text not null check (asset_class in ('EQUITY','FUTURE','OPTION')),
  instrument_key text not null,
  product text not null check (product in ('DELIVERY','INTRADAY','FUTURES','OPTIONS')),
  side text not null check (side in ('BUY','SELL')),
  trigger_type text not null check (trigger_type in ('STOP_LOSS','TARGET')),
  trigger_direction text not null check (trigger_direction in ('AT_OR_ABOVE','AT_OR_BELOW')),
  trigger_price_paise bigint not null check (trigger_price_paise > 0),
  limit_price_paise bigint check (limit_price_paise is null or limit_price_paise > 0),
  quantity integer not null check (quantity > 0 and quantity <= 1000000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','TRIGGERED','FILLED','CANCELLED','REJECTED')),
  last_evaluated_quote_at_ms bigint,
  triggered_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists paper_protective_orders_active_idx
  on public.paper_protective_orders(instrument_key,created_at)
  where status='ACTIVE';
create index if not exists paper_protective_orders_user_idx
  on public.paper_protective_orders(user_id,created_at desc);

-- Drawing payloads and chart preferences are user-editable but size-bounded.
create table if not exists public.paper_chart_drawings (
  drawing_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null,
  timeframe text not null check (length(timeframe) between 1 and 12),
  drawing_type text not null check (drawing_type in (
    'TRENDLINE','HORIZONTAL_LINE','VERTICAL_LINE','RAY','CHANNEL',
    'FIBONACCI_RETRACEMENT','FIBONACCI_EXTENSION','RECTANGLE','CIRCLE',
    'TEXT','ARROW','BRUSH','PRICE_RANGE','DATE_RANGE'
  )),
  payload jsonb not null,
  is_locked boolean not null default false,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_chart_drawing_payload_size check (octet_length(payload::text) <= 16384)
);
create index if not exists paper_chart_drawings_user_instrument_idx
  on public.paper_chart_drawings(user_id,instrument_key,timeframe);

create table if not exists public.paper_chart_templates (
  template_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  configuration jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,name),
  constraint paper_chart_template_size check (octet_length(configuration::text) <= 32768)
);

create table if not exists public.paper_chart_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null,
  chart_type text not null default 'CANDLE' check (chart_type in ('CANDLE','OHLC','BAR','LINE','AREA')),
  timeframe text not null default '1m' check (length(timeframe) between 1 and 12),
  theme text not null default 'DARK' check (theme in ('DARK','LIGHT')),
  indicators jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(user_id,instrument_key),
  constraint paper_chart_indicators_size check (octet_length(indicators::text) <= 16384)
);

create or replace function public.initialize_paper_investing_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_investing_accounts%rowtype;
  v_created boolean := false;
begin
  if p_user_id is null then
    raise exception using errcode='22023',message='A valid Supabase user ID is required';
  end if;
  insert into public.paper_investing_accounts(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing
  returning * into v_account;
  if found then
    v_created := true;
  else
    select * into v_account
      from public.paper_investing_accounts
     where user_id=p_user_id
     for update;
    if not found then
      raise exception using errcode='P0002',message='Paper Investing account could not be initialized';
    end if;
  end if;
  return jsonb_build_object(
    'user_id',v_account.user_id,
    'currency',v_account.currency,
    'starting_cash_paise',v_account.starting_cash_paise,
    'cash_paise',v_account.cash_paise,
    'reserved_cash_paise',v_account.reserved_cash_paise,
    'realized_pnl_paise',v_account.realized_pnl_paise,
    'created',v_created,
    'simulation_only',true
  );
end;
$$;
revoke all on function public.initialize_paper_investing_account(uuid) from public,anon,authenticated;
grant execute on function public.initialize_paper_investing_account(uuid) to service_role;

alter table public.paper_futures_positions enable row level security;
alter table public.paper_futures_orders enable row level security;
alter table public.paper_investing_accounts enable row level security;
alter table public.paper_investing_positions enable row level security;
alter table public.paper_investing_orders enable row level security;
alter table public.paper_protective_orders enable row level security;
alter table public.paper_chart_drawings enable row level security;
alter table public.paper_chart_templates enable row level security;
alter table public.paper_chart_preferences enable row level security;

create policy paper_futures_positions_select_own on public.paper_futures_positions
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_futures_orders_select_own on public.paper_futures_orders
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_investing_accounts_select_own on public.paper_investing_accounts
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_investing_positions_select_own on public.paper_investing_positions
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_investing_orders_select_own on public.paper_investing_orders
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_protective_orders_select_own on public.paper_protective_orders
  for select to authenticated using ((select auth.uid())=user_id);

create policy paper_chart_drawings_select_own on public.paper_chart_drawings
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_chart_drawings_insert_own on public.paper_chart_drawings
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy paper_chart_drawings_update_own on public.paper_chart_drawings
  for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy paper_chart_drawings_delete_own on public.paper_chart_drawings
  for delete to authenticated using ((select auth.uid())=user_id);

create policy paper_chart_templates_select_own on public.paper_chart_templates
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_chart_templates_insert_own on public.paper_chart_templates
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy paper_chart_templates_update_own on public.paper_chart_templates
  for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy paper_chart_templates_delete_own on public.paper_chart_templates
  for delete to authenticated using ((select auth.uid())=user_id);

create policy paper_chart_preferences_select_own on public.paper_chart_preferences
  for select to authenticated using ((select auth.uid())=user_id);
create policy paper_chart_preferences_insert_own on public.paper_chart_preferences
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy paper_chart_preferences_update_own on public.paper_chart_preferences
  for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy paper_chart_preferences_delete_own on public.paper_chart_preferences
  for delete to authenticated using ((select auth.uid())=user_id);

revoke all on public.paper_futures_positions,public.paper_futures_orders,
  public.paper_investing_accounts,public.paper_investing_positions,
  public.paper_investing_orders,public.paper_protective_orders,
  public.paper_chart_drawings,public.paper_chart_templates,public.paper_chart_preferences
  from anon,authenticated;

grant select on public.paper_futures_positions,public.paper_futures_orders,
  public.paper_investing_accounts,public.paper_investing_positions,
  public.paper_investing_orders,public.paper_protective_orders,
  public.paper_chart_drawings,public.paper_chart_templates,public.paper_chart_preferences
  to authenticated;
grant insert,update,delete on public.paper_chart_drawings,
  public.paper_chart_templates,public.paper_chart_preferences to authenticated;
