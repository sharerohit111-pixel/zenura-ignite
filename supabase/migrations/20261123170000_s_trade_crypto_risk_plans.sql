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
