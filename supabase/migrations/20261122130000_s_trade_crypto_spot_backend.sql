-- S-TRADE: isolated Crypto Spot paper-trading ledger.
-- Draft migration for review; intentionally NOT applied to Supabase yet.
-- Uses Supabase Auth UUIDs and integer-like fixed precision (never float arithmetic).
-- Provider quotes must be verified by a trusted server before calling the service-role RPC.

create table if not exists public.paper_crypto_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR' check (currency = 'INR'),
  starting_cash numeric(24,8) not null check (starting_cash > 0),
  cash_balance numeric(24,8) not null check (cash_balance >= 0),
  reserved_cash numeric(24,8) not null default 0 check (reserved_cash >= 0),
  realized_pnl numeric(24,8) not null default 0,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_crypto_reserve_within_cash check (reserved_cash <= cash_balance)
);

create table if not exists public.paper_crypto_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,20}USDT$'),
  base_asset text not null check (base_asset ~ '^[A-Z0-9]{2,12}$'),
  quantity numeric(30,12) not null check (quantity > 0),
  average_entry_price numeric(24,8) not null check (average_entry_price > 0),
  cost_basis numeric(24,8) not null check (cost_basis > 0),
  realized_pnl numeric(24,8) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

create table if not exists public.paper_crypto_orders (
  order_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,20}USDT$'),
  base_asset text not null check (base_asset ~ '^[A-Z0-9]{2,12}$'),
  side text not null check (side in ('BUY','SELL')),
  order_type text not null check (order_type in ('MARKET','LIMIT')),
  status text not null check (status in ('PENDING','FILLED','CANCELLED','REJECTED')),
  quantity numeric(30,12) not null check (quantity > 0),
  limit_price numeric(24,8) check (limit_price is null or limit_price > 0),
  execution_price numeric(24,8) check (execution_price is null or execution_price > 0),
  fx_rate_inr numeric(24,8) check (fx_rate_inr is null or fx_rate_inr > 0),
  gross_value numeric(24,8) check (gross_value is null or gross_value >= 0),
  fee numeric(24,8) not null default 0 check (fee >= 0),
  realized_pnl numeric(24,8) not null default 0,
  quote_timestamp_ms bigint,
  quote_age_ms bigint,
  simulation_only boolean not null default true check (simulation_only),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  filled_at timestamptz,
  unique (user_id, idempotency_key),
  constraint crypto_limit_requires_price check (order_type <> 'LIMIT' or limit_price is not null)
);

create table if not exists public.paper_crypto_ledger (
  ledger_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.paper_crypto_orders(order_id) on delete restrict,
  entry_type text not null check (entry_type in ('BUY','SELL','FEE')),
  currency text not null check (currency = 'INR'),
  amount numeric(24,8) not null,
  balance_before numeric(24,8) not null check (balance_before >= 0),
  balance_after numeric(24,8) not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, entry_type)
);

create index if not exists paper_crypto_orders_user_created_idx
  on public.paper_crypto_orders(user_id, created_at desc);
create index if not exists paper_crypto_positions_user_idx
  on public.paper_crypto_positions(user_id);
create index if not exists paper_crypto_ledger_user_created_idx
  on public.paper_crypto_ledger(user_id, created_at desc);

alter table public.paper_crypto_accounts enable row level security;
alter table public.paper_crypto_positions enable row level security;
alter table public.paper_crypto_orders enable row level security;
alter table public.paper_crypto_ledger enable row level security;

create policy paper_crypto_accounts_read_own on public.paper_crypto_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy paper_crypto_positions_read_own on public.paper_crypto_positions
  for select to authenticated using (user_id = (select auth.uid()));
create policy paper_crypto_orders_read_own on public.paper_crypto_orders
  for select to authenticated using (user_id = (select auth.uid()));
create policy paper_crypto_ledger_read_own on public.paper_crypto_ledger
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.paper_crypto_accounts, public.paper_crypto_positions,
  public.paper_crypto_orders, public.paper_crypto_ledger from anon, authenticated;
grant select on public.paper_crypto_accounts, public.paper_crypto_positions,
  public.paper_crypto_orders, public.paper_crypto_ledger to authenticated;
revoke all on public.paper_crypto_accounts, public.paper_crypto_positions,
  public.paper_crypto_orders, public.paper_crypto_ledger from public;
grant select, insert, update, delete on public.paper_crypto_accounts, public.paper_crypto_positions,
  public.paper_crypto_orders, public.paper_crypto_ledger to service_role;
grant usage, select on sequence public.paper_crypto_ledger_ledger_id_seq to service_role;

create or replace function public.initialize_paper_crypto_account(
  p_user_id uuid,
  p_starting_cash_inr numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_crypto_accounts%rowtype;
begin
  if p_user_id is null or p_starting_cash_inr is null
     or p_starting_cash_inr <= 0 or p_starting_cash_inr > 1000000000 then
    raise exception 'Invalid crypto account initialization input.' using errcode = '22023';
  end if;

  insert into public.paper_crypto_accounts(user_id, starting_cash, cash_balance)
  values (p_user_id, p_starting_cash_inr, p_starting_cash_inr)
  on conflict (user_id) do nothing;

  select * into strict v_account
  from public.paper_crypto_accounts where user_id = p_user_id;

  return jsonb_build_object(
    'user_id', v_account.user_id,
    'currency', v_account.currency,
    'starting_cash', v_account.starting_cash,
    'cash_balance', v_account.cash_balance,
    'version', v_account.version
  );
end;
$$;

create or replace function public.execute_paper_crypto_market_order(
  p_user_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_symbol text,
  p_base_asset text,
  p_side text,
  p_quantity numeric,
  p_execution_price numeric,
  p_fx_rate_inr numeric,
  p_fee numeric,
  p_quote_timestamp_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_crypto_accounts%rowtype;
  v_existing public.paper_crypto_orders%rowtype;
  v_position public.paper_crypto_positions%rowtype;
  v_has_position boolean := false;
  v_now_ms bigint;
  v_quote_age bigint;
  v_gross numeric(24,8);
  v_total numeric(24,8);
  v_new_cash numeric(24,8);
  v_new_qty numeric(30,12);
  v_new_cost numeric(24,8);
  v_allocated_cost numeric(24,8);
  v_realized numeric(24,8) := 0;
  v_balance_before numeric(24,8);
  v_order public.paper_crypto_orders%rowtype;
begin
  if p_user_id is null or p_order_id is null or p_idempotency_key is null
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_symbol is null or p_symbol !~ '^[A-Z0-9]{2,20}USDT$'
     or p_base_asset is null or p_base_asset !~ '^[A-Z0-9]{2,12}$'
     or p_symbol <> (p_base_asset || 'USDT')
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000
     or p_execution_price is null or p_execution_price <= 0 or p_execution_price > 1000000000
     or p_fx_rate_inr is null or p_fx_rate_inr <= 0 or p_fx_rate_inr > 1000000
     or p_fee is null or p_fee < 0 or p_fee > 1000000000
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms < 0 then
    raise exception 'Invalid crypto market order input.' using errcode = '22023';
  end if;

  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_quote_age := v_now_ms - p_quote_timestamp_ms;
  if v_quote_age < -2000 or v_quote_age > 15000 then
    raise exception 'A fresh verified crypto quote is required.' using errcode = '22023';
  end if;

  v_gross := round(p_quantity * p_execution_price * p_fx_rate_inr, 8);
  if v_gross <= 0 or v_gross > 1000000000000 then
    raise exception 'Crypto order value is outside supported limits.' using errcode = '22003';
  end if;

  select * into v_account
  from public.paper_crypto_accounts
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'Crypto paper account is not initialized.' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.paper_crypto_orders
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.order_id <> p_order_id
       or v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'Crypto idempotency key reused with different order details.' using errcode = '23505';
    end if;
    return jsonb_build_object('order', to_jsonb(v_existing),
      'cash_balance', v_account.cash_balance, 'realized_pnl', v_account.realized_pnl,
      'idempotent_replay', true, 'simulation_only', true);
  end if;

  insert into public.paper_crypto_orders(
    order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,
    side,order_type,status,quantity,execution_price,fx_rate_inr,gross_value,fee,
    quote_timestamp_ms,quote_age_ms,simulation_only,filled_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_symbol,p_base_asset,
    p_side,'MARKET','FILLED',p_quantity,p_execution_price,p_fx_rate_inr,v_gross,p_fee,
    p_quote_timestamp_ms,v_quote_age,true,now()
  ) returning * into v_order;

  select * into v_position
  from public.paper_crypto_positions
  where user_id = p_user_id and symbol = p_symbol
  for update;
  v_has_position := found;
  v_balance_before := v_account.cash_balance;

  if p_side = 'BUY' then
    v_total := v_gross + p_fee;
    if v_account.cash_balance - v_account.reserved_cash < v_total then
      raise exception 'Insufficient virtual INR balance.' using errcode = '23514';
    end if;
    v_new_qty := coalesce(v_position.quantity,0) + p_quantity;
    if v_new_qty > 1000000000 then
      raise exception 'Crypto position quantity limit exceeded.' using errcode = '22003';
    end if;
    v_new_cost := round(coalesce(v_position.cost_basis,0) + v_total,8);
    v_new_cash := round(v_account.cash_balance - v_total,8);
    insert into public.paper_crypto_positions(
      user_id,symbol,base_asset,quantity,average_entry_price,cost_basis,updated_at
    ) values (
      p_user_id,p_symbol,p_base_asset,v_new_qty,round(v_new_cost/v_new_qty,8),v_new_cost,now()
    )
    on conflict(user_id,symbol) do update set
      quantity=excluded.quantity,average_entry_price=excluded.average_entry_price,
      cost_basis=excluded.cost_basis,updated_at=now();
    insert into public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
    values (p_user_id,p_order_id,'BUY','INR',-v_gross,v_balance_before,round(v_balance_before-v_gross,8)),
           (p_user_id,p_order_id,'FEE','INR',-p_fee,round(v_balance_before-v_gross,8),v_new_cash);
  else
    if not v_has_position or p_quantity > v_position.quantity then
      raise exception 'Insufficient crypto quantity to sell.' using errcode = '23514';
    end if;
    v_allocated_cost := round(v_position.cost_basis * p_quantity / v_position.quantity,8);
    v_realized := round(v_gross - p_fee - v_allocated_cost,8);
    v_new_cash := round(v_account.cash_balance + v_gross - p_fee,8);
    v_new_qty := v_position.quantity - p_quantity;
    if v_new_qty = 0 then
      delete from public.paper_crypto_positions where user_id=p_user_id and symbol=p_symbol;
    else
      v_new_cost := round(v_position.cost_basis-v_allocated_cost,8);
      update public.paper_crypto_positions
      set quantity=v_new_qty,cost_basis=v_new_cost,
          average_entry_price=round(v_new_cost/v_new_qty,8),
          realized_pnl=realized_pnl+v_realized,updated_at=now()
      where user_id=p_user_id and symbol=p_symbol;
    end if;
    insert into public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
    values (p_user_id,p_order_id,'SELL','INR',v_gross,v_balance_before,round(v_balance_before+v_gross,8)),
           (p_user_id,p_order_id,'FEE','INR',-p_fee,round(v_balance_before+v_gross,8),v_new_cash);
  end if;

  update public.paper_crypto_accounts
  set cash_balance=v_new_cash,realized_pnl=realized_pnl+v_realized,
      version=version+1,updated_at=now()
  where user_id=p_user_id;

  update public.paper_crypto_orders
  set realized_pnl=v_realized,updated_at=now()
  where order_id=p_order_id
  returning * into v_order;

  return jsonb_build_object('order',to_jsonb(v_order),
    'cash_balance',v_new_cash,'realized_pnl',v_realized,
    'account_realized_pnl',v_account.realized_pnl+v_realized,
    'quote_age_ms',v_quote_age,'idempotent_replay',false,'simulation_only',true);
end;
$$;

revoke all on function public.initialize_paper_crypto_account(uuid,numeric) from public, anon, authenticated;
revoke all on function public.execute_paper_crypto_market_order(uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,bigint) from public, anon, authenticated;
grant execute on function public.initialize_paper_crypto_account(uuid,numeric) to service_role;
grant execute on function public.execute_paper_crypto_market_order(uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,bigint) to service_role;

comment on table public.paper_crypto_accounts is 'INR-denominated simulated crypto cash accounts; crypto pairs are converted using a recorded USD/INR reference rate; no live exchange funds.';
comment on table public.paper_crypto_positions is 'User-owned simulated spot crypto positions.';
comment on table public.paper_crypto_orders is 'Immutable-intent simulated crypto spot order history; market execution only in initial RPC.';
comment on table public.paper_crypto_ledger is 'Append-only cash movement ledger for simulated crypto orders.';
