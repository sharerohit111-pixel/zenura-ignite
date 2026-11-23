-- NSE/BSE cash-equity MARKET fill and cash ledger integration.
-- Wrap the existing atomic MARKET RPC so its immutable audit rows commit in
-- the same PostgreSQL transaction as cash, position and order mutations.
-- LIMIT reservation/fill audit events are recorded by the deferred order trigger.

alter function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) rename to _execute_paper_market_order_legacy;

revoke all on function public._execute_paper_market_order_legacy(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) from public, anon, authenticated, service_role;

create or replace function public.execute_paper_market_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_side text,
  p_product text,
  p_quantity integer,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_fill_id uuid;
begin
  -- The legacy RPC takes the per-user account lock and performs all existing
  -- validations/accounting. Any later audit-write error rolls the whole call back.
  v_result:=public._execute_paper_market_order_legacy(
    p_user_id,p_order_id,p_idempotency_key,p_request_fingerprint,
    p_instrument_key,p_trading_symbol,p_exchange,p_side,p_product,p_quantity,
    p_execution_price_paise,p_quote_timestamp_ms,p_quote_age_ms
  );

  if coalesce((v_result->>'idempotent_replay')::boolean,false) then
    return v_result;
  end if;

  select * into v_order from public.paper_orders
   where order_id=p_order_id and user_id=p_user_id and status='FILLED';
  if not found or v_order.order_type<>'MARKET'
     or v_order.exchange is null or v_order.exchange not in ('NSE','BSE')
     or v_order.execution_price_paise is null
     or v_order.gross_paise is null
     or v_order.charges_paise is null
     or v_order.cash_delta_paise is null
     or v_order.quote_timestamp_ms is null then
    raise exception using errcode='23514',
      message='Filled cash-equity MARKET order is missing immutable execution fields';
  end if;

  insert into public.paper_equity_fills(
    user_id,order_id,execution_id,instrument_key,exchange,product,side,
    quantity,execution_price_paise,gross_paise,charges_paise,charges_breakdown,
    cash_delta_paise,realized_pnl_paise,quote_timestamp_ms,filled_at
  ) values (
    v_order.user_id,v_order.order_id,v_order.order_id,v_order.instrument_key,
    v_order.exchange,v_order.product,v_order.side,v_order.quantity,
    v_order.execution_price_paise,v_order.gross_paise,v_order.charges_paise,
    coalesce(v_order.charges_breakdown,'{}'::jsonb),v_order.cash_delta_paise,
    v_order.realized_pnl_paise,v_order.quote_timestamp_ms,
    coalesce(v_order.filled_at,clock_timestamp())
  )
  on conflict(order_id,execution_id) do nothing
  returning fill_id into v_fill_id;

  if v_fill_id is null then
    select fill_id into v_fill_id from public.paper_equity_fills
     where order_id=v_order.order_id and execution_id=v_order.order_id;
  end if;
  if v_fill_id is null then
    raise exception using errcode='23514',message='Cash-equity MARKET fill audit row could not be resolved';
  end if;

  select * into v_account from public.paper_accounts where user_id=p_user_id;
  if not found then
    raise exception using errcode='P0002',message='Paper account disappeared during MARKET settlement';
  end if;

  insert into public.paper_equity_cash_ledger(
    user_id,order_id,fill_id,event_key,event_type,cash_delta_paise,
    reserved_cash_delta_paise,cash_balance_after_paise,
    reserved_cash_after_paise,metadata
  ) values (
    p_user_id,p_order_id,v_fill_id,'trade:'||p_order_id,
    case when v_order.cash_delta_paise<0 then 'TRADE_DEBIT' else 'TRADE_CREDIT' end,
    v_order.cash_delta_paise,0,v_account.cash_paise,v_account.reserved_cash_paise,
    jsonb_build_object('order_type','MARKET','exchange',v_order.exchange,
      'product',v_order.product,'side',v_order.side,
      'execution_id',v_order.order_id,'simulation_only',true)
  )
  on conflict(user_id,event_key) do nothing;

  return v_result;
end;
$$;

revoke all on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) from public, anon, authenticated;
grant execute on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) to service_role;
