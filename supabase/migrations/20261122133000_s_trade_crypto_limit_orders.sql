-- S-TRADE Crypto Spot LIMIT orders: reserve, fill and cancel entirely on the trusted server.
-- This migration is additive. Existing MARKET RPC and guest/local paths remain unchanged.

alter table public.paper_crypto_accounts
  add column if not exists reserved_cash numeric(24,8) not null default 0;
alter table public.paper_crypto_positions
  add column if not exists reserved_quantity numeric(30,12) not null default 0;
alter table public.paper_crypto_orders
  add column if not exists reserved_amount numeric(24,8) not null default 0;

alter table public.paper_crypto_accounts
  drop constraint if exists paper_crypto_reserve_within_cash;
alter table public.paper_crypto_accounts
  add constraint paper_crypto_reserve_within_cash check (reserved_cash >= 0 and reserved_cash <= cash_balance);
alter table public.paper_crypto_positions
  add constraint paper_crypto_reserved_quantity_valid
  check (reserved_quantity >= 0 and reserved_quantity <= quantity);
alter table public.paper_crypto_orders
  add constraint paper_crypto_reserved_amount_valid check (reserved_amount >= 0);

create index if not exists paper_crypto_pending_limit_orders_idx
  on public.paper_crypto_orders(created_at, order_id)
  where order_type='LIMIT' and status='PENDING';

create or replace function public.create_paper_crypto_limit_order(
  p_user_id uuid,p_order_id uuid,p_idempotency_key uuid,p_request_fingerprint text,
  p_symbol text,p_base_asset text,p_side text,p_quantity numeric,
  p_limit_price numeric,p_fx_rate_inr numeric,p_fee numeric
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_account public.paper_crypto_accounts%rowtype;
  v_position public.paper_crypto_positions%rowtype;
  v_existing public.paper_crypto_orders%rowtype;
  v_reserved numeric(24,8);
  v_order public.paper_crypto_orders%rowtype;
begin
  if p_user_id is null or p_order_id is null or p_idempotency_key is null
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_symbol is null or p_symbol !~ '^[A-Z0-9]{2,20}USDT$'
     or p_base_asset is null or p_symbol <> p_base_asset || 'USDT'
     or p_side is null or p_side not in ('BUY','SELL') or p_quantity is null or p_quantity<=0 or p_quantity>1000000000
     or p_limit_price is null or p_limit_price<=0 or p_limit_price>1000000000
     or p_fx_rate_inr is null or p_fx_rate_inr<40 or p_fx_rate_inr>200
     or p_fee is null or p_fee<0 or p_fee>1000000000 then
    raise exception 'Invalid crypto LIMIT order input.' using errcode='22023';
  end if;
  select * into v_account from public.paper_crypto_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Crypto paper account is not initialized.' using errcode='P0002'; end if;
  select * into v_existing from public.paper_crypto_orders
    where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'Crypto idempotency key reused with different LIMIT order details.' using errcode='23505';
    end if;
    return jsonb_build_object('order',to_jsonb(v_existing),'cash_balance',v_account.cash_balance,
      'reserved_cash',v_account.reserved_cash,'idempotent_replay',true,'simulation_only',true);
  end if;
  if p_side='BUY' then
    v_reserved:=round(p_quantity*p_limit_price*p_fx_rate_inr+p_fee,8);
    if v_reserved<=0 or v_reserved>v_account.cash_balance-v_account.reserved_cash then
      raise exception 'Insufficient available virtual INR for LIMIT reservation.' using errcode='23514';
    end if;
    update public.paper_crypto_accounts set reserved_cash=reserved_cash+v_reserved,
      version=version+1,updated_at=now() where user_id=p_user_id;
  else
    select * into v_position from public.paper_crypto_positions
      where user_id=p_user_id and symbol=p_symbol for update;
    if not found or v_position.quantity-v_position.reserved_quantity<p_quantity then
      raise exception 'Insufficient unreserved crypto quantity for LIMIT sell.' using errcode='23514';
    end if;
    update public.paper_crypto_positions set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()
      where user_id=p_user_id and symbol=p_symbol;
    v_reserved:=0;
  end if;
  insert into public.paper_crypto_orders(
    order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,side,
    order_type,status,quantity,limit_price,fx_rate_inr,fee,reserved_amount,simulation_only
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_symbol,p_base_asset,p_side,
    'LIMIT','PENDING',p_quantity,p_limit_price,p_fx_rate_inr,p_fee,v_reserved,true
  ) returning * into v_order;
  return jsonb_build_object('order',to_jsonb(v_order),'cash_balance',v_account.cash_balance,
    'reserved_cash',v_account.reserved_cash+v_reserved,'idempotent_replay',false,'simulation_only',true);
end;
$$;

create or replace function public.cancel_paper_crypto_limit_order(
  p_user_id uuid,p_order_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.paper_crypto_orders%rowtype;
  v_account public.paper_crypto_accounts%rowtype;
begin
  select * into v_order from public.paper_crypto_orders
    where order_id=p_order_id and user_id=p_user_id and order_type='LIMIT' for update;
  if not found then raise exception 'Crypto LIMIT order was not found.' using errcode='P0002'; end if;
  if v_order.status='CANCELLED' then
    return jsonb_build_object('order',to_jsonb(v_order),'cancelled',true,'idempotent_replay',true,'simulation_only',true);
  end if;
  if v_order.status<>'PENDING' then raise exception 'Only pending crypto LIMIT orders can be cancelled.' using errcode='55000'; end if;
  if v_order.side='BUY' then
    select * into v_account from public.paper_crypto_accounts where user_id=p_user_id for update;
    if not found or v_account.reserved_cash<v_order.reserved_amount then
      raise exception 'Crypto LIMIT cash reservation is inconsistent.' using errcode='23514';
    end if;
    update public.paper_crypto_accounts set reserved_cash=reserved_cash-v_order.reserved_amount,
      version=version+1,updated_at=now() where user_id=p_user_id;
  else
    update public.paper_crypto_positions set reserved_quantity=reserved_quantity-v_order.quantity,updated_at=now()
      where user_id=p_user_id and symbol=v_order.symbol and reserved_quantity>=v_order.quantity;
    if not found then raise exception 'Crypto LIMIT quantity reservation is inconsistent.' using errcode='23514'; end if;
  end if;
  update public.paper_crypto_orders set status='CANCELLED',reserved_amount=0,updated_at=now()
    where order_id=p_order_id returning * into v_order;
  return jsonb_build_object('order',to_jsonb(v_order),'cancelled',true,'idempotent_replay',false,'simulation_only',true);
end;
$$;

create or replace function public.fill_paper_crypto_limit_order(
  p_user_id uuid,p_order_id uuid,p_execution_price numeric,p_fx_rate_inr numeric,
  p_fee numeric,p_quote_timestamp_ms bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.paper_crypto_orders%rowtype;
  v_account public.paper_crypto_accounts%rowtype;
  v_position public.paper_crypto_positions%rowtype;
  v_now_ms bigint;
  v_age bigint;
  v_gross numeric(24,8);
  v_total numeric(24,8);
  v_cash numeric(24,8);
  v_qty numeric(30,12);
  v_cost numeric(24,8);
  v_allocated numeric(24,8);
  v_realized numeric(24,8):=0;
  v_before numeric(24,8);
begin
  select * into v_order from public.paper_crypto_orders
    where order_id=p_order_id and user_id=p_user_id and order_type='LIMIT' for update;
  if not found then raise exception 'Crypto LIMIT order was not found.' using errcode='P0002'; end if;
  if v_order.status='FILLED' then
    select * into v_account from public.paper_crypto_accounts where user_id=p_user_id;
    return jsonb_build_object('order',to_jsonb(v_order),'cash_balance',v_account.cash_balance,
      'idempotent_replay',true,'simulation_only',true);
  end if;
  if v_order.status<>'PENDING' then raise exception 'Crypto LIMIT order is no longer pending.' using errcode='55000'; end if;
  if p_execution_price is null or p_execution_price<=0 or p_execution_price>1000000000
     or p_fx_rate_inr is null or p_fx_rate_inr<40 or p_fx_rate_inr>200
     or p_fee is null or p_fee<0 or p_fee>1000000000
     or p_quote_timestamp_ms is null then
    raise exception 'Invalid verified crypto LIMIT fill quote.' using errcode='22023';
  end if;
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_age:=v_now_ms-p_quote_timestamp_ms;
  if v_age < -2000 or v_age > 15000 then raise exception 'Fresh crypto fill quote required.' using errcode='22023'; end if;
  if (v_order.side='BUY' and p_execution_price>v_order.limit_price)
     or (v_order.side='SELL' and p_execution_price<v_order.limit_price) then
    raise exception 'Market quote has not reached the crypto LIMIT price.' using errcode='55000';
  end if;
  v_gross:=round(v_order.quantity*p_execution_price*p_fx_rate_inr,8);
  v_total:=v_gross+p_fee;
  select * into v_account from public.paper_crypto_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Crypto account missing.' using errcode='P0002'; end if;
  v_before:=v_account.cash_balance;
  if v_order.side='BUY' then
    if v_account.reserved_cash<v_order.reserved_amount or v_account.cash_balance<v_total then
      raise exception 'Crypto LIMIT cash reservation is inconsistent.' using errcode='23514';
    end if;
    v_qty:=coalesce((select quantity from public.paper_crypto_positions where user_id=p_user_id and symbol=v_order.symbol),0)+v_order.quantity;
    if v_qty>1000000000 then raise exception 'Crypto position quantity limit exceeded.' using errcode='22003'; end if;
    v_cost:=round(coalesce((select cost_basis from public.paper_crypto_positions where user_id=p_user_id and symbol=v_order.symbol),0)+v_total,8);
    insert into public.paper_crypto_positions(user_id,symbol,base_asset,quantity,average_entry_price,cost_basis,updated_at)
      values(p_user_id,v_order.symbol,v_order.base_asset,v_qty,round(v_cost/v_qty,8),v_cost,now())
      on conflict(user_id,symbol) do update set quantity=excluded.quantity,
        average_entry_price=excluded.average_entry_price,cost_basis=excluded.cost_basis,updated_at=now();
    v_cash:=round(v_account.cash_balance-v_total,8);
    update public.paper_crypto_accounts set cash_balance=v_cash,
      reserved_cash=reserved_cash-v_order.reserved_amount,version=version+1,updated_at=now()
      where user_id=p_user_id;
    insert into public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
      values(p_user_id,p_order_id,'BUY','INR',-v_gross,v_before,round(v_before-v_gross,8)),
            (p_user_id,p_order_id,'FEE','INR',-p_fee,round(v_before-v_gross,8),v_cash);
  else
    select * into v_position from public.paper_crypto_positions
      where user_id=p_user_id and symbol=v_order.symbol for update;
    if not found or v_position.quantity<v_order.quantity or v_position.reserved_quantity<v_order.quantity then
      raise exception 'Crypto LIMIT position reservation is inconsistent.' using errcode='23514';
    end if;
    v_allocated:=round(v_position.cost_basis*v_order.quantity/v_position.quantity,8);
    v_realized:=round(v_gross-p_fee-v_allocated,8);
    v_qty:=v_position.quantity-v_order.quantity;
    if v_qty=0 then
      delete from public.paper_crypto_positions where user_id=p_user_id and symbol=v_order.symbol;
    else
      v_cost:=round(v_position.cost_basis-v_allocated,8);
      update public.paper_crypto_positions set quantity=v_qty,reserved_quantity=reserved_quantity-v_order.quantity,
        cost_basis=v_cost,average_entry_price=round(v_cost/v_qty,8),
        realized_pnl=realized_pnl+v_realized,updated_at=now()
        where user_id=p_user_id and symbol=v_order.symbol;
    end if;
    v_cash:=round(v_account.cash_balance+v_gross-p_fee,8);
    update public.paper_crypto_accounts set cash_balance=v_cash,
      version=version+1,realized_pnl=realized_pnl+v_realized,updated_at=now()
      where user_id=p_user_id;
    insert into public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
      values(p_user_id,p_order_id,'SELL','INR',v_gross,v_before,round(v_before+v_gross,8)),
            (p_user_id,p_order_id,'FEE','INR',-p_fee,round(v_before+v_gross,8),v_cash);
  end if;
  update public.paper_crypto_orders set status='FILLED',execution_price=p_execution_price,
    fx_rate_inr=p_fx_rate_inr,gross_value=v_gross,fee=p_fee,realized_pnl=v_realized,
    quote_timestamp_ms=p_quote_timestamp_ms,quote_age_ms=v_age,reserved_amount=0,
    filled_at=now(),updated_at=now() where order_id=p_order_id returning * into v_order;
  return jsonb_build_object('order',to_jsonb(v_order),'cash_balance',v_cash,
    'realized_pnl',v_realized,'quote_age_ms',v_age,'idempotent_replay',false,'simulation_only',true);
end;
$$;

revoke all on function public.create_paper_crypto_limit_order(uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.cancel_paper_crypto_limit_order(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fill_paper_crypto_limit_order(uuid,uuid,numeric,numeric,numeric,bigint) from public,anon,authenticated;
grant execute on function public.create_paper_crypto_limit_order(uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.cancel_paper_crypto_limit_order(uuid,uuid) to service_role;
grant execute on function public.fill_paper_crypto_limit_order(uuid,uuid,numeric,numeric,numeric,bigint) to service_role;

comment on function public.create_paper_crypto_limit_order(uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric)
  is 'Creates a simulated crypto LIMIT order and atomically reserves INR cash or unreserved base quantity.';
comment on function public.fill_paper_crypto_limit_order(uuid,uuid,numeric,numeric,numeric,bigint)
  is 'Fills only a pending simulated crypto LIMIT order using a fresh server-verified quote at or better than its limit.';


-- Dedicated cursor and lease: crypto LIMIT scanning must not share the equities worker cursor.
create table if not exists public.paper_crypto_limit_worker_state (
  state_key text primary key default 'crypto_limit_orders' check (state_key='crypto_limit_orders'),
  cursor_created_at timestamptz,
  cursor_order_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.paper_crypto_limit_worker_state enable row level security;
revoke all on public.paper_crypto_limit_worker_state from public,anon,authenticated;
grant select,insert,update,delete on public.paper_crypto_limit_worker_state to service_role;

create or replace function public.acquire_paper_crypto_limit_worker_lease(
  p_lease_token uuid,p_now_ms bigint,p_ttl_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_token uuid;
begin
  if p_lease_token is null or p_now_ms is null or p_now_ms<0
     or p_ttl_ms is null or p_ttl_ms not between 5000 and 120000 then
    raise exception 'Invalid crypto LIMIT worker lease request' using errcode='22023';
  end if;
  insert into public.paper_crypto_limit_worker_state(
    state_key,lease_token,lease_expires_at,updated_at
  ) values('crypto_limit_orders',p_lease_token,
    to_timestamp((p_now_ms+p_ttl_ms)::double precision/1000.0),clock_timestamp())
  on conflict(state_key) do update set lease_token=excluded.lease_token,
    lease_expires_at=excluded.lease_expires_at,updated_at=clock_timestamp()
  where public.paper_crypto_limit_worker_state.lease_token is null
     or public.paper_crypto_limit_worker_state.lease_expires_at is null
     or public.paper_crypto_limit_worker_state.lease_expires_at<=to_timestamp(p_now_ms::numeric/1000)
  returning lease_token into v_token;
  return coalesce(v_token=p_lease_token,false);
end;
$$;

create or replace function public.release_paper_crypto_limit_worker_lease(
  p_lease_token uuid,p_now_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
  if p_lease_token is null or p_now_ms is null or p_now_ms<0 then
    raise exception 'Invalid crypto LIMIT worker lease release' using errcode='22023';
  end if;
  update public.paper_crypto_limit_worker_state
     set lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
   where state_key='crypto_limit_orders' and lease_token=p_lease_token;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke all on function public.acquire_paper_crypto_limit_worker_lease(uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.release_paper_crypto_limit_worker_lease(uuid,bigint) from public,anon,authenticated;
grant execute on function public.acquire_paper_crypto_limit_worker_lease(uuid,bigint,bigint) to service_role;
grant execute on function public.release_paper_crypto_limit_worker_lease(uuid,bigint) to service_role;
