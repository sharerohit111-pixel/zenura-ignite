-- S-TRADE Crypto cloud SL/Target plans.
-- Additive and isolated. Plans reserve their exit quantity so LIMIT orders and
-- risk exits cannot sell the same units twice. No live exchange orders are sent.

create table if not exists public.paper_crypto_risk_plans (
  plan_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,20}USDT$'),
  base_asset text not null check (base_asset ~ '^[A-Z0-9]{2,12}$'),
  quantity numeric(30,12) not null check (quantity > 0),
  stop_loss_price numeric(24,8) check (stop_loss_price is null or stop_loss_price > 0),
  take_profit_price numeric(24,8) check (take_profit_price is null or take_profit_price > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED','TRIGGERED','EXECUTED','FAILED')),
  trigger_reason text check (trigger_reason is null or trigger_reason in ('STOP_LOSS','TAKE_PROFIT')),
  trigger_price numeric(24,8),
  triggered_at timestamptz,
  executed_order_id uuid references public.paper_crypto_orders(order_id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key),
  check (stop_loss_price is not null or take_profit_price is not null),
  check (stop_loss_price is null or take_profit_price is null or stop_loss_price < take_profit_price)
);
create unique index if not exists paper_crypto_one_active_risk_plan_per_symbol
  on public.paper_crypto_risk_plans(user_id,symbol) where status in ('ACTIVE','TRIGGERED');
create index if not exists paper_crypto_active_risk_plans_idx
  on public.paper_crypto_risk_plans(symbol,created_at) where status='ACTIVE';

alter table public.paper_crypto_risk_plans enable row level security;
create policy paper_crypto_risk_plans_read_own on public.paper_crypto_risk_plans
  for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.paper_crypto_risk_plans from public,anon,authenticated;
grant select on public.paper_crypto_risk_plans to authenticated;
grant select,insert,update,delete on public.paper_crypto_risk_plans to service_role;

create or replace function public.create_paper_crypto_risk_plan(
  p_user_id uuid,p_plan_id uuid,p_idempotency_key uuid,p_symbol text,p_base_asset text,
  p_quantity numeric,p_stop_loss_price numeric,p_take_profit_price numeric
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_pos public.paper_crypto_positions%rowtype; v_existing public.paper_crypto_risk_plans%rowtype; v_plan public.paper_crypto_risk_plans%rowtype;
begin
  if p_user_id is null or p_plan_id is null or p_idempotency_key is null
     or p_symbol is null or p_symbol !~ '^[A-Z0-9]{2,20}USDT$'
     or p_base_asset is null or p_symbol<>p_base_asset||'USDT'
     or p_quantity is null or p_quantity<=0
     or (p_stop_loss_price is null and p_take_profit_price is null)
     or (p_stop_loss_price is not null and p_stop_loss_price<=0)
     or (p_take_profit_price is not null and p_take_profit_price<=0)
     or (p_stop_loss_price is not null and p_take_profit_price is not null and p_stop_loss_price>=p_take_profit_price) then
    raise exception 'Invalid Crypto risk plan.' using errcode='22023';
  end if;
  select * into v_existing from public.paper_crypto_risk_plans
   where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.plan_id<>p_plan_id or v_existing.symbol<>p_symbol or v_existing.quantity<>p_quantity
       or v_existing.stop_loss_price is distinct from p_stop_loss_price
       or v_existing.take_profit_price is distinct from p_take_profit_price then
      raise exception 'Risk plan idempotency key reused with different details.' using errcode='23505';
    end if;
    return jsonb_build_object('plan',to_jsonb(v_existing),'idempotent_replay',true,'simulation_only',true);
  end if;
  select * into v_pos from public.paper_crypto_positions
   where user_id=p_user_id and symbol=p_symbol for update;
  if not found or v_pos.quantity-v_pos.reserved_quantity<p_quantity then
    raise exception 'Insufficient unreserved Crypto quantity for SL/Target plan.' using errcode='23514';
  end if;
  update public.paper_crypto_positions set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()
   where user_id=p_user_id and symbol=p_symbol;
  insert into public.paper_crypto_risk_plans(plan_id,user_id,symbol,base_asset,quantity,
    stop_loss_price,take_profit_price,idempotency_key)
  values(p_plan_id,p_user_id,p_symbol,p_base_asset,p_quantity,p_stop_loss_price,p_take_profit_price,p_idempotency_key)
  returning * into v_plan;
  return jsonb_build_object('plan',to_jsonb(v_plan),'idempotent_replay',false,'simulation_only',true);
end;
$$;

create or replace function public.cancel_paper_crypto_risk_plan(p_user_id uuid,p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_plan public.paper_crypto_risk_plans%rowtype; v_pos public.paper_crypto_positions%rowtype;
begin
  select * into v_plan from public.paper_crypto_risk_plans
   where plan_id=p_plan_id and user_id=p_user_id for update;
  if not found then raise exception 'Crypto risk plan not found.' using errcode='P0002'; end if;
  if v_plan.status='CANCELLED' then
    return jsonb_build_object('plan',to_jsonb(v_plan),'cancelled',true,'idempotent_replay',true,'simulation_only',true);
  end if;
  if v_plan.status<>'ACTIVE' then raise exception 'Only active Crypto risk plans can be cancelled.' using errcode='55000'; end if;
  select * into v_pos from public.paper_crypto_positions
   where user_id=p_user_id and symbol=v_plan.symbol for update;
  if not found or v_pos.reserved_quantity<v_plan.quantity then
    raise exception 'Crypto risk reservation is inconsistent.' using errcode='23514';
  end if;
  update public.paper_crypto_positions set reserved_quantity=reserved_quantity-v_plan.quantity,updated_at=now()
   where user_id=p_user_id and symbol=v_plan.symbol;
  update public.paper_crypto_risk_plans set status='CANCELLED',updated_at=now()
   where plan_id=p_plan_id returning * into v_plan;
  return jsonb_build_object('plan',to_jsonb(v_plan),'cancelled',true,'idempotent_replay',false,'simulation_only',true);
end;
$$;

revoke all on function public.create_paper_crypto_risk_plan(uuid,uuid,uuid,text,text,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.cancel_paper_crypto_risk_plan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_paper_crypto_risk_plan(uuid,uuid,uuid,text,text,numeric,numeric,numeric) to service_role;
grant execute on function public.cancel_paper_crypto_risk_plan(uuid,uuid) to service_role;

-- Atomically executes a triggered risk exit through the same immutable order/ledger.
-- It can only consume the exact quantity reserved by this plan.
create or replace function public.execute_paper_crypto_risk_exit(
  p_user_id uuid,p_plan_id uuid,p_execution_price numeric,p_fx_rate_inr numeric,
  p_fee numeric,p_quote_timestamp_ms bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_plan public.paper_crypto_risk_plans%rowtype;
  v_account public.paper_crypto_accounts%rowtype;
  v_pos public.paper_crypto_positions%rowtype;
  v_now_ms bigint; v_age bigint; v_gross numeric(24,8); v_allocated numeric(24,8);
  v_realized numeric(24,8); v_cash numeric(24,8); v_qty numeric(30,12); v_cost numeric(24,8);
  v_reason text; v_order public.paper_crypto_orders%rowtype; v_order_id uuid;
  v_key uuid; v_fp text;
begin
  if p_user_id is null or p_plan_id is null or p_execution_price is null or p_execution_price<=0
     or p_execution_price>1000000000 or p_fx_rate_inr is null or p_fx_rate_inr<40 or p_fx_rate_inr>200
     or p_fee is null or p_fee<0 or p_fee>1000000000 or p_quote_timestamp_ms is null then
    raise exception 'Invalid Crypto risk exit quote.' using errcode='22023';
  end if;
  select * into v_plan from public.paper_crypto_risk_plans
   where plan_id=p_plan_id and user_id=p_user_id for update;
  if not found then raise exception 'Crypto risk plan not found.' using errcode='P0002'; end if;
  if v_plan.status='EXECUTED' then
    select * into v_order from public.paper_crypto_orders where order_id=v_plan.executed_order_id;
    select * into v_account from public.paper_crypto_accounts where user_id=p_user_id;
    return jsonb_build_object('plan',to_jsonb(v_plan),'order',to_jsonb(v_order),
      'cash_balance',v_account.cash_balance,'idempotent_replay',true,'simulation_only',true);
  end if;
  if v_plan.status<>'ACTIVE' then raise exception 'Crypto risk plan is not active.' using errcode='55000'; end if;
  v_reason:=case when v_plan.stop_loss_price is not null and p_execution_price<=v_plan.stop_loss_price then 'STOP_LOSS'
                 when v_plan.take_profit_price is not null and p_execution_price>=v_plan.take_profit_price then 'TAKE_PROFIT' end;
  if v_reason is null then raise exception 'Crypto risk threshold has not been reached.' using errcode='55000'; end if;
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_age:=v_now_ms-p_quote_timestamp_ms;
  if v_age < -2000 or v_age>15000 then raise exception 'Fresh Crypto risk exit quote required.' using errcode='22023'; end if;
  select * into v_account from public.paper_crypto_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Crypto account not found.' using errcode='P0002'; end if;
  select * into v_pos from public.paper_crypto_positions where user_id=p_user_id and symbol=v_plan.symbol for update;
  if not found or v_pos.quantity<v_plan.quantity or v_pos.reserved_quantity<v_plan.quantity then
    raise exception 'Crypto risk plan quantity reservation is inconsistent.' using errcode='23514';
  end if;
  v_gross:=round(v_plan.quantity*p_execution_price*p_fx_rate_inr,8);
  if v_gross<=0 or v_gross>1000000000000 then raise exception 'Crypto risk exit value out of range.' using errcode='22003'; end if;
  v_allocated:=round(v_pos.cost_basis*v_plan.quantity/v_pos.quantity,8);
  v_realized:=round(v_gross-p_fee-v_allocated,8);
  v_cash:=round(v_account.cash_balance+v_gross-p_fee,8);
  v_qty:=v_pos.quantity-v_plan.quantity;
  v_order_id:=v_plan.plan_id;
  v_key:=v_plan.idempotency_key;
  v_fp:=repeat(md5(v_plan.plan_id::text||':RISK_EXIT'),2);
  insert into public.paper_crypto_orders(order_id,user_id,idempotency_key,request_fingerprint,
    symbol,base_asset,side,order_type,status,quantity,execution_price,fx_rate_inr,gross_value,
    fee,realized_pnl,quote_timestamp_ms,quote_age_ms,simulation_only,filled_at)
  values(v_order_id,p_user_id,v_key,v_fp,v_plan.symbol,v_plan.base_asset,'SELL','MARKET','FILLED',
    v_plan.quantity,p_execution_price,p_fx_rate_inr,v_gross,p_fee,v_realized,
    p_quote_timestamp_ms,v_age,true,now())
  on conflict (user_id,idempotency_key) do nothing;
  select * into v_order from public.paper_crypto_orders where user_id=p_user_id and idempotency_key=v_key for update;
  if v_order.order_id<>v_order_id or v_order.request_fingerprint<>v_fp then
    raise exception 'Crypto risk exit idempotency conflict.' using errcode='23505';
  end if;
  if v_qty=0 then
    -- Clear the plan's final reserve before DELETE; the shared reserved-position
    -- guard intentionally blocks deleting rows with any nonzero old reserve.
    update public.paper_crypto_positions set reserved_quantity=0,updated_at=now()
     where user_id=p_user_id and symbol=v_plan.symbol;
    delete from public.paper_crypto_positions where user_id=p_user_id and symbol=v_plan.symbol;
  else
    v_cost:=round(v_pos.cost_basis-v_allocated,8);
    update public.paper_crypto_positions set quantity=v_qty,reserved_quantity=reserved_quantity-v_plan.quantity,
      cost_basis=v_cost,average_entry_price=round(v_cost/v_qty,8),
      realized_pnl=realized_pnl+v_realized,updated_at=now()
    where user_id=p_user_id and symbol=v_plan.symbol;
  end if;
  update public.paper_crypto_accounts set cash_balance=v_cash,realized_pnl=realized_pnl+v_realized,
    version=version+1,updated_at=now() where user_id=p_user_id;
  insert into public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
  values(p_user_id,v_order_id,'SELL','INR',v_gross,v_account.cash_balance,round(v_account.cash_balance+v_gross,8)),
        (p_user_id,v_order_id,'FEE','INR',-p_fee,round(v_account.cash_balance+v_gross,8),v_cash);
  update public.paper_crypto_risk_plans set status='EXECUTED',trigger_reason=v_reason,
    trigger_price=p_execution_price,triggered_at=now(),executed_order_id=v_order_id,updated_at=now()
  where plan_id=p_plan_id returning * into v_plan;
  return jsonb_build_object('plan',to_jsonb(v_plan),'order',to_jsonb(v_order),
    'cash_balance',v_cash,'realized_pnl',v_realized,'idempotent_replay',false,'simulation_only',true);
end;
$$;
revoke all on function public.execute_paper_crypto_risk_exit(uuid,uuid,numeric,numeric,numeric,bigint) from public,anon,authenticated;
grant execute on function public.execute_paper_crypto_risk_exit(uuid,uuid,numeric,numeric,numeric,bigint) to service_role;
