-- Forward-only draft migration. Do not apply to production before disposable staging rehearsal.
-- Atomic NSE cash-equity MARKET settlement with indicative charges included in cash,
-- cost basis, realized P&L and order history. BSE is deliberately fail-closed until
-- the official scrip-group/exclusive-category inputs are available to the backend.
alter table public.paper_orders
  add column if not exists charges_paise bigint not null default 0
    check (charges_paise >= 0),
  add column if not exists charges_breakdown jsonb not null default '{}'::jsonb
    check (jsonb_typeof(charges_breakdown)='object'),
  add column if not exists cash_delta_paise bigint not null default 0;

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
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_has_position boolean := false;
  v_open_count integer;
  v_reserved_qty integer := 0;
  v_gross bigint;
  v_cost bigint;
  v_allocated_cost bigint;
  v_remaining_cost bigint;
  v_remaining_qty integer;
  v_new_qty integer;
  v_new_cost bigint;
  v_new_average bigint;
  v_cash bigint;
  v_available_cash bigint;
  v_mode_realized bigint;
  v_aggregate_realized bigint;
  v_order_realized bigint := 0;
  v_order public.paper_orders%rowtype;
  v_now_ms bigint;
  v_actual_quote_age_ms bigint;
  v_brokerage bigint;
  v_exchange bigint;
  v_ipft bigint;
  v_sebi bigint;
  v_stt bigint;
  v_stamp bigint;
  v_dp bigint;
  v_gst bigint;
  v_charges bigint;
  v_net_gross bigint;
  v_cash_delta bigint;
  v_breakdown jsonb;
begin
  if p_user_id is null or p_idempotency_key is null
     or p_order_id is null or p_request_fingerprint is null
     or p_side is null or p_product is null or p_quantity is null
     or p_execution_price_paise is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_side not in ('BUY','SELL')
     or p_product not in ('DELIVERY','INTRADAY')
     or p_exchange is null or p_exchange <> 'NSE'
     or p_quantity not between 1 and 1000000
     or p_execution_price_paise <= 0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms <= 0
     or p_quote_age_ms is null or p_quote_age_ms < 0
     or p_quote_age_ms > 15000 then
    raise exception using errcode='22023', message='Invalid request: NSE cash-equity MARKET orders require a verified supported instrument and fee schedule';
  end if;

  -- Never trust a caller-supplied quote age or clock: derive freshness from PostgreSQL time.
  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_actual_quote_age_ms := v_now_ms - p_quote_timestamp_ms;
  if not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_now_ms)
     or abs(v_actual_quote_age_ms - p_quote_age_ms) > 2000 then
    raise exception using errcode='22023', message='Invalid or stale paper market quote';
  end if;

  -- Lock account first: serializes all cash/position/order mutations for this user.
  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then
    raise exception using errcode='P0002', message='Paper account is not initialized';
  end if;

  if v_account.reserved_cash_paise + v_account.reserved_margin_paise > v_account.cash_paise
     or v_account.reserved_cash_paise < 0 or v_account.reserved_margin_paise < 0 then
    raise exception using errcode='23514', message='Invalid account reservations';
  end if;

  -- Idempotent retry: return the existing result, but reject key reuse with
  -- a different fingerprint. Account lock makes the check/create sequence safe.
  select * into v_order from public.paper_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_order.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode='23505', message='Idempotency key reused for a different order';
    end if;
    return jsonb_build_object('order_id',v_order.order_id,'status',v_order.status,
      'cash_paise',v_account.cash_paise,'realized_pnl_paise',v_account.realized_pnl_paise,
      'gross_paise',v_order.gross_paise,'charges_paise',v_order.charges_paise,
      'charges_breakdown',v_order.charges_breakdown,'cash_delta_paise',v_order.cash_delta_paise,
      'idempotent_replay',true,'simulation_only',true);
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505', message='Order ID already exists';
  end if;

  v_gross := p_execution_price_paise::bigint * p_quantity::bigint;
  if v_gross <= 0 or v_gross > 9007199254740991 then
    raise exception using errcode='22003', message='Order value exceeds supported limits';
  end if;

  -- NSE cash-equity indicative schedule, version 2026-03-01.
  -- Integer paise; PostgreSQL round(numeric) gives half-away-from-zero.
  v_brokerage := case when p_product='DELIVERY' then 2000::bigint
    else least(2000::bigint,round(v_gross::numeric*0.001)::bigint) end;
  v_exchange := round(v_gross::numeric*0.000030699)::bigint;
  v_ipft := round(v_gross::numeric*0.000000001)::bigint;
  v_sebi := round(v_gross::numeric*0.000001)::bigint;
  v_stt := case
    when p_product='DELIVERY' then round(v_gross::numeric*0.001)::bigint
    when p_side='SELL' then round(v_gross::numeric*0.00025)::bigint
    else 0 end;
  v_stamp := case
    when p_side='BUY' and p_product='DELIVERY' then round(v_gross::numeric*0.00015)::bigint
    when p_side='BUY' and p_product='INTRADAY' then round(v_gross::numeric*0.00003)::bigint
    else 0 end;
  v_dp := case when p_product='DELIVERY' and p_side='SELL' then 2000 else 0 end;
  v_gst := round((v_brokerage+v_exchange+v_ipft+v_dp)::numeric*0.18)::bigint;
  v_charges := v_brokerage+v_exchange+v_ipft+v_sebi+v_stt+v_stamp+v_dp+v_gst;
  if v_charges<0 or v_gross+v_charges>9007199254740991 then
    raise exception using errcode='22003',message='NSE cash-equity charges exceed supported limits';
  end if;
  v_net_gross := case when p_side='BUY' then v_gross+v_charges else v_gross-v_charges end;
  if p_side='SELL' and v_net_gross<=0 then
    raise exception using errcode='22003',message='NSE cash-equity SELL net proceeds would be negative after minimum charges';
  end if;
  v_cash_delta := case when p_side='BUY' then -v_net_gross else v_net_gross end;
  v_breakdown := jsonb_build_object(
    'schedule_version','2026-03-01','exchange','NSE','product',p_product,'side',p_side,
    'gross_paise',v_gross,'brokerage_paise',v_brokerage,
    'exchange_transaction_paise',v_exchange,'ipft_paise',v_ipft,'sebi_paise',v_sebi,
    'stt_paise',v_stt,'stamp_duty_paise',v_stamp,'dp_charges_paise',v_dp,
    'gst_paise',v_gst,'total_charges_paise',v_charges,
    'indicative',true,'simulation_only',true
  );
  v_available_cash := v_account.cash_paise - v_account.reserved_cash_paise - v_account.reserved_margin_paise;
  v_cash := v_account.cash_paise;
  v_aggregate_realized := v_account.realized_pnl_paise;
  v_mode_realized := case when p_product='DELIVERY'
    then v_account.delivery_realized_pnl_paise else v_account.intraday_realized_pnl_paise end;

  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key
   for update;
  v_has_position := found;

  if p_side='BUY' then
    if not v_has_position then
      select count(*) into v_open_count from public.paper_equity_positions
       where user_id=p_user_id and quantity > 0;
      if v_open_count >= 50 then
        raise exception using errcode='23514', message='Paper portfolio is limited to 50 open positions';
      end if;
      if v_available_cash < v_net_gross then
        raise exception using errcode='23514', message='Insufficient unreserved virtual cash including estimated charges';
      end if;
      insert into public.paper_equity_positions(
        user_id,product,instrument_key,trading_symbol,exchange,quantity,
        average_price_paise,cost_basis_paise,reserved_quantity,updated_at
      ) values (
        p_user_id,p_product,p_instrument_key,p_trading_symbol,p_exchange,p_quantity,
        round(v_net_gross::numeric/p_quantity)::bigint,v_net_gross,0,now()
      );
    else
      if v_position.quantity + p_quantity > 1000000 then
        raise exception using errcode='22003', message='Position quantity exceeds supported limit';
      end if;
      v_new_qty := v_position.quantity + p_quantity;
      v_new_cost := v_position.cost_basis_paise + v_net_gross;
      if v_new_cost > 9007199254740991 or v_available_cash < v_net_gross then
        raise exception using errcode='23514', message='Insufficient cash including charges or unsupported position cost';
      end if;
      v_new_average := round(v_new_cost::numeric / v_new_qty)::bigint;
      update public.paper_equity_positions set
        quantity=v_new_qty,average_price_paise=v_new_average,cost_basis_paise=v_new_cost,
        trading_symbol=coalesce(p_trading_symbol,trading_symbol),
        exchange=coalesce(p_exchange,exchange),updated_at=now()
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    end if;
    v_cash := v_account.cash_paise - v_net_gross;
  else
    if not v_has_position then
      raise exception using errcode='23514', message='No position available to sell';
    end if;
    v_reserved_qty := v_position.reserved_quantity;
    if p_quantity > v_position.quantity - v_reserved_qty then
      raise exception using errcode='23514', message='Insufficient unreserved shares';
    end if;
    v_cost := v_position.cost_basis_paise;
    v_allocated_cost := case when p_quantity=v_position.quantity then v_cost
      else floor((v_cost::numeric*p_quantity + floor(v_position.quantity/2)) / v_position.quantity)::bigint end;
    v_remaining_cost := v_cost - v_allocated_cost;
    v_remaining_qty := v_position.quantity - p_quantity;
    v_order_realized := v_net_gross - v_allocated_cost;
    if v_remaining_qty=0 then
      delete from public.paper_equity_positions
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    else
      update public.paper_equity_positions set quantity=v_remaining_qty,
        cost_basis_paise=v_remaining_cost,
        average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
        updated_at=now()
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    end if;
    v_cash := v_account.cash_paise + v_net_gross;
    if v_cash < v_account.reserved_cash_paise+v_account.reserved_margin_paise then
      raise exception using errcode='23514',message='SELL charges exceed available virtual cash after existing reservations';
    end if;
    v_aggregate_realized := v_aggregate_realized + v_order_realized;
    v_mode_realized := v_mode_realized + v_order_realized;
    if v_cash > 9007199254740991 or abs(v_aggregate_realized) > 9007199254740991
       or abs(v_mode_realized) > 9007199254740991 then
      raise exception using errcode='22003', message='Account balance or P&L exceeds supported limits';
    end if;
  end if;

  insert into public.paper_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,side,product,order_type,status,quantity,
    execution_price_paise,gross_paise,charges_paise,charges_breakdown,cash_delta_paise,
    realized_pnl_paise,quote_timestamp_ms,quote_age_ms,reservation_released,
    simulation_only,filled_at,created_at,updated_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
    p_trading_symbol,p_exchange,p_side,p_product,'MARKET','FILLED',p_quantity,
    p_execution_price_paise,v_gross,v_charges,v_breakdown,v_cash_delta,
    v_order_realized,p_quote_timestamp_ms,v_actual_quote_age_ms,true,true,now(),now(),now()
  );

  update public.paper_accounts set cash_paise=v_cash,
    realized_pnl_paise=v_aggregate_realized,
    delivery_realized_pnl_paise=case when p_product='DELIVERY' then v_mode_realized else delivery_realized_pnl_paise end,
    intraday_realized_pnl_paise=case when p_product='INTRADAY' then v_mode_realized else intraday_realized_pnl_paise end,
    version=version+1,updated_at=now()
   where user_id=p_user_id;

  return jsonb_build_object('order_id',p_order_id,'status','FILLED',
    'cash_paise',v_cash,'gross_paise',v_gross,'charges_paise',v_charges,
    'charges_breakdown',v_breakdown,'cash_delta_paise',v_cash_delta,
    'realized_pnl_paise',v_aggregate_realized,
    'order_realized_pnl_paise',v_order_realized,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;


revoke all on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) from public, anon, authenticated;
grant execute on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) to service_role;
