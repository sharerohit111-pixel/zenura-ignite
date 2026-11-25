-- Atomic NSE equity LIMIT fill + cash ledger integration.
-- Preserve the existing validated execution routines as private transaction helpers.
-- Each wrapper appends one fill, one trade cash event and (for BUY) one reservation
-- consumption event in the same PostgreSQL transaction as the portfolio mutation.

alter function public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)
  rename to _execute_paper_limit_fill_without_ledger;
revoke all on function public._execute_paper_limit_fill_without_ledger(text,bigint,bigint,bigint,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.execute_paper_limit_fill(
  p_order_id text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_result jsonb;
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_fill_id uuid;
  v_reserved_cash_paise bigint:=0;
  v_user_id uuid;
begin
  -- Match cancellation lock order: account first, then order. Locking the order
  -- first here can deadlock against cancellation holding the account row.
  select user_id into strict v_user_id from public.paper_orders where order_id=p_order_id;
  perform 1 from public.paper_accounts where user_id=v_user_id for update;
  select * into strict v_order from public.paper_orders where order_id=p_order_id for update;
  v_reserved_cash_paise:=v_order.reserved_cash_paise;

  v_result:=public._execute_paper_limit_fill_without_ledger(
    p_order_id,p_execution_price_paise,p_quote_timestamp_ms,p_quote_age_ms,p_now_ms
  );
  if coalesce((v_result->>'already_filled')::boolean,false) then
    return v_result;
  end if;

  select * into strict v_order from public.paper_orders
   where order_id=p_order_id;
  select * into strict v_account from public.paper_accounts
   where user_id=v_order.user_id;

  insert into public.paper_equity_fills(
    user_id,order_id,execution_id,instrument_key,exchange,product,side,
    quantity,execution_price_paise,gross_paise,charges_paise,
    charges_breakdown,cash_delta_paise,realized_pnl_paise,quote_timestamp_ms
  ) values (
    v_order.user_id,v_order.order_id,'limit:'||v_order.order_id,
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
    'limit-trade:'||v_order.order_id,
    case when v_order.side='BUY' then 'TRADE_DEBIT' else 'TRADE_CREDIT' end,
    v_order.cash_delta_paise,0,
    v_account.cash_paise,v_account.reserved_cash_paise,
    jsonb_build_object('source','execute_paper_limit_fill','product',v_order.product,
      'exchange',v_order.exchange,'charges_paise',v_order.charges_paise,
      'realized_pnl_paise',v_order.realized_pnl_paise,'simulation_only',true)
  );

  if v_order.side='BUY' and v_reserved_cash_paise>0 then
    insert into public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,
      reserved_cash_after_paise,metadata
    ) values (
      v_order.user_id,v_order.order_id,'limit-reserve-consume:'||v_order.order_id,
      'RESERVATION_CONSUME',0,-v_reserved_cash_paise,
      v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('source','execute_paper_limit_fill',
        'reservation_paise',v_reserved_cash_paise,'simulation_only',true)
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)
  to service_role;

alter function public.execute_paper_intraday_limit_fill(text,bigint,bigint,bigint,bigint)
  rename to _execute_paper_intraday_limit_fill_without_ledger;
revoke all on function public._execute_paper_intraday_limit_fill_without_ledger(text,bigint,bigint,bigint,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.execute_paper_intraday_limit_fill(
  p_order_id text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_result jsonb;
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_fill_id uuid;
  v_reserved_cash_paise bigint:=0;
  v_user_id uuid;
begin
  -- Match Intraday cancellation lock order: account first, then order.
  select user_id into strict v_user_id from public.paper_orders where order_id=p_order_id;
  perform 1 from public.paper_accounts where user_id=v_user_id for update;
  select * into strict v_order from public.paper_orders where order_id=p_order_id for update;
  v_reserved_cash_paise:=v_order.reserved_cash_paise;

  v_result:=public._execute_paper_intraday_limit_fill_without_ledger(
    p_order_id,p_execution_price_paise,p_quote_timestamp_ms,p_quote_age_ms,p_now_ms
  );
  if coalesce((v_result->>'already_filled')::boolean,false) then
    return v_result;
  end if;

  select * into strict v_order from public.paper_orders
   where order_id=p_order_id;
  select * into strict v_account from public.paper_accounts
   where user_id=v_order.user_id;

  insert into public.paper_equity_fills(
    user_id,order_id,execution_id,instrument_key,exchange,product,side,
    quantity,execution_price_paise,gross_paise,charges_paise,
    charges_breakdown,cash_delta_paise,realized_pnl_paise,quote_timestamp_ms
  ) values (
    v_order.user_id,v_order.order_id,'intraday-limit:'||v_order.order_id,
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
    'intraday-limit-trade:'||v_order.order_id,
    case when v_order.side='BUY' then 'TRADE_DEBIT' else 'TRADE_CREDIT' end,
    v_order.cash_delta_paise,0,
    v_account.cash_paise,v_account.reserved_cash_paise,
    jsonb_build_object('source','execute_paper_intraday_limit_fill',
      'product',v_order.product,'exchange',v_order.exchange,
      'charges_paise',v_order.charges_paise,
      'realized_pnl_paise',v_order.realized_pnl_paise,'simulation_only',true)
  );

  if v_order.side='BUY' and v_reserved_cash_paise>0 then
    insert into public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,
      reserved_cash_after_paise,metadata
    ) values (
      v_order.user_id,v_order.order_id,'intraday-limit-reserve-consume:'||v_order.order_id,
      'RESERVATION_CONSUME',0,-v_reserved_cash_paise,
      v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('source','execute_paper_intraday_limit_fill',
        'reservation_paise',v_reserved_cash_paise,'simulation_only',true)
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.execute_paper_intraday_limit_fill(text,bigint,bigint,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.execute_paper_intraday_limit_fill(text,bigint,bigint,bigint,bigint)
  to service_role;
