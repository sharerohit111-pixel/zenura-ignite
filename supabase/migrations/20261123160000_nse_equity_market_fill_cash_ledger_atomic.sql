-- Atomic NSE equity MARKET fill + cash-ledger integration.
-- Call the pre-audit accounting implementation directly. The dependency branch
-- installed a wrapper that already writes ledger rows; calling that wrapper here
-- would duplicate fills and cash events.
-- The deferred order trigger is superseded by the explicit atomic MARKET and LIMIT
-- wrappers in this accounting branch, so remove it before those wrappers run.
drop trigger if exists paper_equity_orders_audit_deferred on public.paper_orders;

-- Normalize both supported migration-chain shapes:
-- (a) standalone accounting branch: execute_paper_market_order is still the core RPC;
-- (b) PR merge with the ledger-foundation branch: execute_paper_market_order is its
--     audit wrapper and _execute_paper_market_order_legacy is the pre-audit core.
-- Move the true core to one stable private name so this migration behaves identically
-- in push CI and in the eventual PR merge commit.
do $$
begin
  if to_regprocedure(
    'public._execute_paper_market_order_legacy(uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint)'
  ) is not null then
    alter function public._execute_paper_market_order_legacy(
      uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
    ) rename to _execute_paper_market_order_core;

    alter function public.execute_paper_market_order(
      uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
    ) rename to _execute_paper_market_order_without_ledger;
  else
    alter function public.execute_paper_market_order(
      uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
    ) rename to _execute_paper_market_order_core;
  end if;
end;
$$;

revoke all on function public._execute_paper_market_order_core(
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
  v_result:=public._execute_paper_market_order_core(
    p_user_id,p_order_id,p_idempotency_key,p_request_fingerprint,
    p_instrument_key,p_trading_symbol,p_exchange,p_side,p_product,
    p_quantity,p_execution_price_paise,p_quote_timestamp_ms,p_quote_age_ms
  );

  -- Replays return the original order receipt and must never create new audit rows.
  if coalesce((v_result->>'idempotent_replay')::boolean,false) then
    return v_result;
  end if;

  select * into strict v_order from public.paper_orders
   where order_id=p_order_id and user_id=p_user_id;
  select * into strict v_account from public.paper_accounts
   where user_id=p_user_id;

  insert into public.paper_equity_fills(
    user_id,order_id,execution_id,instrument_key,exchange,product,side,
    quantity,execution_price_paise,gross_paise,charges_paise,
    charges_breakdown,cash_delta_paise,realized_pnl_paise,quote_timestamp_ms
  ) values (
    v_order.user_id,v_order.order_id,'market:'||v_order.order_id,
    v_order.instrument_key,v_order.exchange,v_order.product,v_order.side,
    v_order.quantity,v_order.execution_price_paise,v_order.gross_paise,
    v_order.charges_paise,v_order.charges_breakdown,v_order.cash_delta_paise,
    v_order.realized_pnl_paise,v_order.quote_timestamp_ms
  ) returning fill_id into v_fill_id;

  insert into public.paper_equity_cash_ledger(
    user_id,order_id,fill_id,event_key,event_type,
    cash_delta_paise,reserved_cash_delta_paise,
    cash_balance_after_paise,reserved_cash_after_paise,metadata
  ) values (
    v_order.user_id,v_order.order_id,v_fill_id,
    'market-cash:'||v_order.order_id,
    case when v_order.side='BUY' then 'TRADE_DEBIT' else 'TRADE_CREDIT' end,
    v_order.cash_delta_paise,0,
    v_account.cash_paise,v_account.reserved_cash_paise,
    jsonb_build_object(
      'source','execute_paper_market_order',
      'product',v_order.product,
      'exchange',v_order.exchange,
      'charges_paise',v_order.charges_paise,
      'realized_pnl_paise',v_order.realized_pnl_paise,
      'simulation_only',true
    )
  );

  return v_result;
end;
$$;

revoke all on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) to service_role;
