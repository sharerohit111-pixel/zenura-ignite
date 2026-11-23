-- Shared, integer-paise NSE cash-equity charge schedule for LIMIT settlement.
-- BSE cash orders remain fail-closed until exact scrip-group inputs are available.
create or replace function public._paper_nse_cash_equity_charges(
  p_gross_paise bigint,p_product text,p_side text
) returns jsonb
language plpgsql immutable set search_path=''
as $$
declare
  v_brokerage bigint;
  v_exchange bigint;
  v_ipft bigint;
  v_sebi bigint;
  v_stt bigint;
  v_stamp bigint;
  v_dp bigint;
  v_gst bigint;
  v_total bigint;
begin
  if p_gross_paise is null or p_gross_paise<1 or p_gross_paise>9007199254740991
     or p_product is null or p_product not in ('DELIVERY','INTRADAY')
     or p_side is null or p_side not in ('BUY','SELL') then
    raise exception using errcode='22023',message='Invalid NSE cash-equity charge request';
  end if;
  v_brokerage:=case when p_product='DELIVERY' then 2000::bigint
    else least(2000::bigint,round(p_gross_paise::numeric*0.001)::bigint) end;
  v_exchange:=round(p_gross_paise::numeric*0.000030699)::bigint;
  v_ipft:=round(p_gross_paise::numeric*0.000000001)::bigint;
  v_sebi:=round(p_gross_paise::numeric*0.000001)::bigint;
  v_stt:=case when p_product='DELIVERY' then round(p_gross_paise::numeric*0.001)::bigint
    when p_side='SELL' then round(p_gross_paise::numeric*0.00025)::bigint else 0 end;
  v_stamp:=case when p_side='BUY' and p_product='DELIVERY'
      then round(p_gross_paise::numeric*0.00015)::bigint
    when p_side='BUY' and p_product='INTRADAY'
      then round(p_gross_paise::numeric*0.00003)::bigint else 0 end;
  v_dp:=case when p_product='DELIVERY' and p_side='SELL' then 2000 else 0 end;
  v_gst:=round((v_brokerage+v_exchange+v_ipft+v_dp)::numeric*0.18)::bigint;
  v_total:=v_brokerage+v_exchange+v_ipft+v_sebi+v_stt+v_stamp+v_dp+v_gst;
  if v_total<0 or v_total>9007199254740991 or p_gross_paise+v_total>9007199254740991 then
    raise exception using errcode='22003',message='NSE cash-equity charges exceed supported limits';
  end if;
  return jsonb_build_object(
    'schedule_version','2026-03-01','exchange','NSE','product',p_product,'side',p_side,
    'gross_paise',p_gross_paise,'brokerage_paise',v_brokerage,
    'exchange_transaction_paise',v_exchange,'ipft_paise',v_ipft,'sebi_paise',v_sebi,
    'stt_paise',v_stt,'stamp_duty_paise',v_stamp,'dp_charges_paise',v_dp,
    'gst_paise',v_gst,'total_charges_paise',v_total,
    'indicative',true,'simulation_only',true
  );
end;
$$;
revoke all on function public._paper_nse_cash_equity_charges(bigint,text,text)
  from public,anon,authenticated,service_role;

-- Do not strand pre-migration gross-only reservations. Drain/cancel all open
-- LIMIT orders before this forward-only accounting change is applied.
DO $limit_fee_migration_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.paper_orders
     WHERE order_type='LIMIT' AND status IN ('PENDING','PARTIALLY_FILLED')
  ) THEN
    RAISE EXCEPTION 'Cancel or expire all open LIMIT orders before applying fee-inclusive LIMIT settlement';
  END IF;
END
$limit_fee_migration_preflight$;

create or replace function public.submit_paper_limit_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_side text,
  p_quantity integer,
  p_limit_price_paise bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_existing public.paper_orders%rowtype;
  v_reserve bigint;
  v_available bigint;
  v_new_reserved integer;
  v_gross bigint;
  v_breakdown jsonb;
begin
  if p_user_id is null or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_limit_price_paise is null or p_limit_price_paise <= 0 then
    raise exception using errcode='22023', message='Invalid paper LIMIT order request';
  end if;

  -- LIMIT is deliberately Delivery-only, matching the existing API/worker.
  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then
    raise exception using errcode='P0002', message='Paper account is not initialized';
  end if;
  if v_account.cash_paise < 0 or v_account.reserved_cash_paise < 0
     or v_account.reserved_margin_paise < 0
     or v_account.reserved_cash_paise + v_account.reserved_margin_paise > v_account.cash_paise
     or v_account.version < 1 then
    raise exception using errcode='23514', message='Invalid account reservations or balance';
  end if;

  select * into v_existing from public.paper_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode='23505', message='Idempotency key reused for a different order';
    end if;
    return jsonb_build_object('order_id',v_existing.order_id,'status',v_existing.status,
      'reserved_cash_paise',v_existing.reserved_cash_paise,
      'reserved_quantity',v_existing.reserved_quantity,'idempotent_replay',true,
      'simulation_only',true);
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505', message='Order ID already exists';
  end if;

  if p_exchange is distinct from 'NSE' then
    raise exception using errcode='22023',message='BSE cash LIMIT settlement is disabled until verified scrip-group charges are available';
  end if;
  v_gross := p_limit_price_paise::bigint * p_quantity::bigint;
  if v_gross <= 0 or v_gross > 9007199254740991 then
    raise exception using errcode='22003', message='LIMIT reservation exceeds supported limits';
  end if;
  v_breakdown := public._paper_nse_cash_equity_charges(v_gross,'DELIVERY','BUY');
  if p_side='SELL' and (public._paper_nse_cash_equity_charges(v_gross,'DELIVERY','SELL')->>'total_charges_paise')::bigint>=v_gross then
    raise exception using errcode='22003',message='LIMIT SELL turnover is too small to cover minimum NSE charges';
  end if;
  v_reserve := v_gross + (v_breakdown->>'total_charges_paise')::bigint;

  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and product='DELIVERY' and instrument_key=p_instrument_key
   for update;

  if p_side='BUY' then
    v_available := v_account.cash_paise - v_account.reserved_cash_paise - v_account.reserved_margin_paise;
    if v_available < v_reserve then
      raise exception using errcode='23514', message='Insufficient unreserved virtual cash for LIMIT BUY';
    end if;
    insert into public.paper_orders(
      order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
      trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,
      reservation_released,simulation_only,created_at,updated_at
    ) values (
      p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'BUY','DELIVERY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,v_reserve,0,false,true,now(),now()
    );
    update public.paper_accounts set reserved_cash_paise=reserved_cash_paise+v_reserve,
      version=version+1,updated_at=now() where user_id=p_user_id;
  else
    if not found then
      raise exception using errcode='23514', message='No Delivery position available to reserve';
    end if;
    if p_quantity > v_position.quantity-v_position.reserved_quantity then
      raise exception using errcode='23514', message='Insufficient unreserved Delivery shares';
    end if;
    v_new_reserved := v_position.reserved_quantity+p_quantity;
    update public.paper_equity_positions set reserved_quantity=v_new_reserved,updated_at=now()
     where user_id=p_user_id and product='DELIVERY' and instrument_key=p_instrument_key;
    insert into public.paper_orders(
      order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
      trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,
      reservation_released,simulation_only,created_at,updated_at
    ) values (
      p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'SELL','DELIVERY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,0,p_quantity,false,true,now(),now()
    );
    update public.paper_accounts set version=version+1,updated_at=now()
     where user_id=p_user_id;
  end if;

  return jsonb_build_object('order_id',p_order_id,'status','PENDING',
    'reserved_cash_paise',case when p_side='BUY' then v_reserve else 0 end,
    'reserved_quantity',case when p_side='SELL' then p_quantity else 0 end,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

create or replace function public.execute_paper_limit_fill(
  p_order_id text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint,
  p_now_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_gross bigint;
  v_allocated bigint;
  v_remaining_cost bigint;
  v_remaining_qty integer;
  v_cash bigint;
  v_reserved_cash bigint;
  v_reserved_qty integer;
  v_order_realized bigint := 0;
  v_realized bigint;
  v_open_count integer;
  v_has_position boolean := false;
  v_server_now_ms bigint;
  v_actual_quote_age_ms bigint;
  v_breakdown jsonb;
  v_charges bigint;
  v_net bigint;
  v_cash_delta bigint;
  v_limit_gross bigint;
  v_expected_reserve bigint;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_execution_price_paise is null or p_execution_price_paise <= 0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms <= 0
     or p_quote_age_ms is null or p_quote_age_ms < 0 or p_quote_age_ms > 15000
     or p_now_ms is null or p_now_ms < p_quote_timestamp_ms
     or p_now_ms-p_quote_timestamp_ms > 15000
     or abs((p_now_ms-p_quote_timestamp_ms)-p_quote_age_ms) > 2000 then
    raise exception using errcode='22023', message='Invalid or stale LIMIT execution quote';
  end if;
  v_server_now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000 or p_quote_timestamp_ms>v_server_now_ms then
    raise exception using errcode='22023', message='LIMIT quote clock is not current or timestamp is in the future';
  end if;
  v_actual_quote_age_ms := v_server_now_ms-p_quote_timestamp_ms;
  if v_actual_quote_age_ms>15000 or abs(v_actual_quote_age_ms-p_quote_age_ms)>2000 then
    raise exception using errcode='22023', message='LIMIT quote age does not match database time';
  end if;

  select * into v_order from public.paper_orders where order_id=p_order_id;
  if not found then raise exception using errcode='P0002', message='LIMIT order not found'; end if;

  select * into v_account from public.paper_accounts
   where user_id=v_order.user_id for update;
  if not found then raise exception using errcode='P0002', message='Paper account is not initialized'; end if;

  -- Re-read after acquiring the account lock; another worker/cancel may have won.
  select * into v_order from public.paper_orders where order_id=p_order_id for update;
  if v_order.status='FILLED' then
    return jsonb_build_object('order_id',p_order_id,'status','FILLED','already_filled',true);
  end if;
  if v_order.status<>'PENDING' or v_order.order_type<>'LIMIT'
     or v_order.product<>'DELIVERY' or v_order.simulation_only is not true
     or v_order.reservation_released is true then
    raise exception using errcode='23514', message='LIMIT order is not eligible for execution';
  end if;
  if (v_order.side='BUY' and p_execution_price_paise>v_order.limit_price_paise)
     or (v_order.side='SELL' and p_execution_price_paise<v_order.limit_price_paise) then
    raise exception using errcode='23514', message='Market price has not reached the LIMIT price';
  end if;

  if v_order.exchange is distinct from 'NSE' then
    raise exception using errcode='22023',message='BSE cash LIMIT settlement is disabled until verified scrip-group charges are available';
  end if;
  v_gross := p_execution_price_paise::bigint*v_order.quantity::bigint;
  if v_gross <= 0 or v_gross > 9007199254740991 then
    raise exception using errcode='22003', message='LIMIT fill value exceeds supported limits';
  end if;
  v_breakdown:=public._paper_nse_cash_equity_charges(v_gross,'DELIVERY',v_order.side);
  v_charges:=(v_breakdown->>'total_charges_paise')::bigint;
  v_net:=case when v_order.side='BUY' then v_gross+v_charges else v_gross-v_charges end;
  if v_order.side='SELL' and v_net<=0 then
    raise exception using errcode='22003',message='LIMIT SELL charges must be lower than execution proceeds';
  end if;
  v_cash_delta:=case when v_order.side='BUY' then -v_net else v_net end;
  v_limit_gross:=v_order.limit_price_paise::bigint*v_order.quantity::bigint;
  v_expected_reserve:=v_limit_gross+
    (public._paper_nse_cash_equity_charges(v_limit_gross,'DELIVERY','BUY')->>'total_charges_paise')::bigint;

  select * into v_position from public.paper_equity_positions
   where user_id=v_order.user_id and product='DELIVERY'
     and instrument_key=v_order.instrument_key for update;
  v_has_position := found;

  if v_order.side='BUY' then
    if v_order.reserved_cash_paise<>v_expected_reserve
       or v_order.reserved_quantity<>0
       or v_account.reserved_cash_paise<v_order.reserved_cash_paise then
      raise exception using errcode='23514', message='LIMIT BUY reservation is inconsistent';
    end if;
    if not v_has_position then
      select count(*) into v_open_count from public.paper_equity_positions
       where user_id=v_order.user_id and quantity>0;
      if v_open_count>=50 then
        raise exception using errcode='23514', message='Paper portfolio is limited to 50 open positions';
      end if;
      insert into public.paper_equity_positions(
        user_id,product,instrument_key,trading_symbol,exchange,quantity,
        average_price_paise,cost_basis_paise,reserved_quantity,updated_at
      ) values (v_order.user_id,'DELIVERY',v_order.instrument_key,
        v_order.trading_symbol,v_order.exchange,v_order.quantity,
        round(v_net::numeric/v_order.quantity)::bigint,v_net,0,now());
    else
      if v_position.quantity+v_order.quantity>1000000
         or v_position.cost_basis_paise+v_net>9007199254740991 then
        raise exception using errcode='22003', message='LIMIT BUY position exceeds supported limits';
      end if;
      update public.paper_equity_positions set
        quantity=quantity+v_order.quantity,
        cost_basis_paise=cost_basis_paise+v_net,
        average_price_paise=round((cost_basis_paise+v_net)::numeric/(quantity+v_order.quantity))::bigint,
        trading_symbol=coalesce(v_order.trading_symbol,trading_symbol),
        exchange=coalesce(v_order.exchange,exchange),updated_at=now()
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    end if;
    v_cash:=v_account.cash_paise-v_net;
    v_reserved_cash:=v_account.reserved_cash_paise-v_order.reserved_cash_paise;
    if v_cash<v_reserved_cash+v_account.reserved_margin_paise then
      raise exception using errcode='23514', message='LIMIT BUY fill would consume funds reserved by other orders';
    end if;
    update public.paper_accounts set cash_paise=v_cash,reserved_cash_paise=v_reserved_cash,
      version=version+1,updated_at=now() where user_id=v_order.user_id;
  else
    if not v_has_position or v_order.reserved_cash_paise<>0
       or v_order.reserved_quantity<>v_order.quantity
       or v_position.reserved_quantity<v_order.reserved_quantity
       or v_position.quantity<v_order.quantity then
      raise exception using errcode='23514', message='LIMIT SELL share reservation is inconsistent';
    end if;
    v_allocated:=case when v_order.quantity=v_position.quantity then v_position.cost_basis_paise
      else floor((v_position.cost_basis_paise::numeric*v_order.quantity
        + floor(v_position.quantity/2)) / v_position.quantity)::bigint end;
    v_remaining_cost:=v_position.cost_basis_paise-v_allocated;
    v_remaining_qty:=v_position.quantity-v_order.quantity;
    v_order_realized:=v_net-v_allocated;
    v_cash:=v_account.cash_paise+v_net;
    v_realized:=v_account.realized_pnl_paise+v_order_realized;
    if v_cash<v_account.reserved_cash_paise+v_account.reserved_margin_paise then
      raise exception using errcode='23514',message='LIMIT SELL proceeds cannot cover existing cash reservations';
    end if;
    if v_cash>9007199254740991 or abs(v_realized)>9007199254740991 then
      raise exception using errcode='22003', message='LIMIT SELL account totals exceed supported limits';
    end if;
    if v_remaining_qty=0 then
      delete from public.paper_equity_positions
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    else
      update public.paper_equity_positions set quantity=v_remaining_qty,
        cost_basis_paise=v_remaining_cost,
        average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
        reserved_quantity=reserved_quantity-v_order.reserved_quantity,updated_at=now()
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    end if;
    update public.paper_accounts set cash_paise=v_cash,realized_pnl_paise=v_realized,
      delivery_realized_pnl_paise=delivery_realized_pnl_paise+v_order_realized,
      version=version+1,updated_at=now() where user_id=v_order.user_id;
  end if;

  update public.paper_orders set status='FILLED',execution_price_paise=p_execution_price_paise,
    gross_paise=v_gross,charges_paise=v_charges,charges_breakdown=v_breakdown,
    cash_delta_paise=v_cash_delta,realized_pnl_paise=v_order_realized,
    quote_timestamp_ms=p_quote_timestamp_ms,quote_age_ms=v_actual_quote_age_ms,
    reservation_released=true,worker_execution=true,filled_at=now(),updated_at=now()
   where order_id=p_order_id;

  return jsonb_build_object('order_id',p_order_id,'status','FILLED',
    'execution_price_paise',p_execution_price_paise,'gross_paise',v_gross,
    'charges_paise',v_charges,'charges_breakdown',v_breakdown,'cash_delta_paise',v_cash_delta,
    'realized_pnl_paise',v_order_realized,'simulation_only',true);
end;
$$;

create or replace function public.submit_paper_intraday_limit_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_side text,
  p_quantity integer,
  p_limit_price_paise bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_existing public.paper_orders%rowtype;
  v_session public.paper_exchange_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_date date;
  v_minute integer;
  v_reserve bigint;
  v_gross bigint;
  v_breakdown jsonb;
begin
  if p_user_id is null or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_exchange is null or p_exchange not in ('NSE','BSE')
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_limit_price_paise is null or p_limit_price_paise<=0 then
    raise exception using errcode='22023',message='Invalid Intraday LIMIT order request';
  end if;

  select * into v_account from public.paper_accounts where user_id=p_user_id for update;
  if not found then raise exception using errcode='P0002',message='Paper account is not initialized'; end if;
  if v_account.cash_paise<0 or v_account.reserved_cash_paise<0
     or v_account.reserved_margin_paise<0
     or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_account.cash_paise then
    raise exception using errcode='23514',message='Invalid paper account reservations';
  end if;

  select * into v_existing from public.paper_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>p_request_fingerprint
       or v_existing.order_type<>'LIMIT' or v_existing.product<>'INTRADAY' then
      raise exception using errcode='23505',message='Idempotency key reused for a different order';
    end if;
    return jsonb_build_object('order_id',v_existing.order_id,'status',v_existing.status,
      'reserved_cash_paise',v_existing.reserved_cash_paise,
      'reserved_quantity',v_existing.reserved_quantity,'idempotent_replay',true,'simulation_only',true);
  end if;

  v_date:=(v_now at time zone 'Asia/Kolkata')::date;
  v_minute:=(extract(hour from v_now at time zone 'Asia/Kolkata')::integer*60)
            +extract(minute from v_now at time zone 'Asia/Kolkata')::integer;
  select * into v_session from public.paper_exchange_sessions
   where exchange=p_exchange and session_date=v_date
     and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
     and verified_at<=v_now and length(btrim(source_reference))>0;
  if not found or v_minute<v_session.open_minute or v_minute>=v_session.close_minute then
    raise exception using errcode='23514',message='No verified open exchange session for Intraday LIMIT';
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505',message='Order ID already exists';
  end if;

  if p_exchange is distinct from 'NSE' then
    raise exception using errcode='22023',message='BSE Intraday LIMIT settlement is disabled until verified scrip-group charges are available';
  end if;
  v_gross:=p_limit_price_paise::bigint*p_quantity::bigint;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception using errcode='22003',message='Intraday LIMIT reservation exceeds supported limits';
  end if;
  v_breakdown:=public._paper_nse_cash_equity_charges(v_gross,'INTRADAY','BUY');
  if p_side='SELL' and (public._paper_nse_cash_equity_charges(v_gross,'INTRADAY','SELL')->>'total_charges_paise')::bigint>=v_gross then
    raise exception using errcode='22003',message='Intraday LIMIT SELL turnover is too small to cover NSE charges';
  end if;
  v_reserve:=v_gross+(v_breakdown->>'total_charges_paise')::bigint;

  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and product='INTRADAY' and instrument_key=p_instrument_key for update;
  if p_side='BUY' then
    if v_account.cash_paise-v_account.reserved_cash_paise-v_account.reserved_margin_paise<v_reserve then
      raise exception using errcode='23514',message='Insufficient unreserved virtual cash for Intraday LIMIT BUY';
    end if;
    insert into public.paper_orders(order_id,user_id,idempotency_key,request_fingerprint,
      instrument_key,trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,reservation_released,
      simulation_only,created_at,updated_at)
    values(p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'BUY','INTRADAY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,v_reserve,0,false,true,v_now,v_now);
    update public.paper_accounts set reserved_cash_paise=reserved_cash_paise+v_reserve,
      version=version+1,updated_at=v_now where user_id=p_user_id;
  else
    if not found or p_quantity>v_position.quantity-v_position.reserved_quantity then
      raise exception using errcode='23514',message='Insufficient unreserved Intraday shares';
    end if;
    update public.paper_equity_positions set reserved_quantity=reserved_quantity+p_quantity,updated_at=v_now
     where user_id=p_user_id and product='INTRADAY' and instrument_key=p_instrument_key;
    insert into public.paper_orders(order_id,user_id,idempotency_key,request_fingerprint,
      instrument_key,trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,reservation_released,
      simulation_only,created_at,updated_at)
    values(p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'SELL','INTRADAY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,0,p_quantity,false,true,v_now,v_now);
    update public.paper_accounts set version=version+1,updated_at=v_now where user_id=p_user_id;
  end if;
  return jsonb_build_object('order_id',p_order_id,'status','PENDING',
    'reserved_cash_paise',case when p_side='BUY' then v_reserve else 0 end,
    'reserved_quantity',case when p_side='SELL' then p_quantity else 0 end,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

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
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_session public.paper_exchange_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_now_ms bigint;
  v_age bigint;
  v_gross bigint;
  v_allocated_cost bigint;
  v_remaining_cost bigint;
  v_remaining_qty integer;
  v_new_qty integer;
  v_new_cost bigint;
  v_cash bigint;
  v_reserved_cash bigint;
  v_realized bigint:=0;
  v_aggregate_realized bigint;
  v_intraday_realized bigint;
  v_today date;
  v_minute integer;
  v_quote_local timestamp without time zone;
  v_quote_minute integer;
  v_breakdown jsonb;
  v_charges bigint;
  v_net bigint;
  v_cash_delta bigint;
  v_limit_gross bigint;
  v_expected_reserve bigint;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_execution_price_paise is null or p_execution_price_paise<=0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms<=0
     or p_quote_age_ms is null or p_quote_age_ms<0 or p_quote_age_ms>15000
     or p_now_ms is null or p_now_ms<=0 then
    raise exception using errcode='22023',message='Invalid Intraday LIMIT fill request';
  end if;
  v_now_ms:=floor(extract(epoch from v_now)*1000)::bigint;
  v_age:=v_now_ms-p_quote_timestamp_ms;
  if v_age<0 or v_age>15000 or abs(v_age-p_quote_age_ms)>2000
     or abs(v_now_ms-p_now_ms)>2000 then
    raise exception using errcode='22023',message='Intraday LIMIT quote is stale or caller clock is invalid';
  end if;

  select * into v_order from public.paper_orders where order_id=p_order_id;
  if not found or v_order.product<>'INTRADAY' or v_order.order_type<>'LIMIT' then
    raise exception using errcode='P0002',message='Intraday LIMIT order not found';
  end if;
  select * into v_account from public.paper_accounts where user_id=v_order.user_id for update;
  if not found then raise exception using errcode='P0002',message='Paper account is not initialized'; end if;
  select * into v_order from public.paper_orders where order_id=p_order_id for update;
  if v_order.status='FILLED' then
    return jsonb_build_object('order_id',p_order_id,'status','FILLED','already_filled',true,'simulation_only',true);
  end if;
  if v_order.status<>'PENDING' or v_order.reservation_released is true then
    raise exception using errcode='23514',message='Intraday LIMIT order is not fillable';
  end if;

  v_today:=(v_now at time zone 'Asia/Kolkata')::date;
  v_minute:=extract(hour from v_now at time zone 'Asia/Kolkata')::integer*60
            +extract(minute from v_now at time zone 'Asia/Kolkata')::integer;
  select * into v_session from public.paper_exchange_sessions
   where exchange=v_order.exchange and session_date=v_today and is_trading_day is true
     and session_kind in ('REGULAR','SPECIAL') and verified_at<=v_now
     and length(btrim(source_reference))>0;
  if not found or v_minute<v_session.open_minute or v_minute>=v_session.close_minute
     or (v_order.created_at at time zone 'Asia/Kolkata')::date<>v_today then
    raise exception using errcode='23514',message='Intraday LIMIT fill is outside its verified exchange session';
  end if;
  v_quote_local:=to_timestamp(p_quote_timestamp_ms::numeric/1000) at time zone 'Asia/Kolkata';
  v_quote_minute:=extract(hour from v_quote_local)::integer*60
                  +extract(minute from v_quote_local)::integer;
  if v_quote_local::date<>v_today or v_quote_minute<v_session.open_minute
     or v_quote_minute>=v_session.close_minute then
    raise exception using errcode='23514',message='Intraday LIMIT quote timestamp is outside the verified exchange session';
  end if;
  if v_order.exchange is distinct from 'NSE' then
    raise exception using errcode='22023',message='BSE Intraday LIMIT settlement is disabled until verified scrip-group charges are available';
  end if;
  if (v_order.side='BUY' and p_execution_price_paise>v_order.limit_price_paise)
     or (v_order.side='SELL' and p_execution_price_paise<v_order.limit_price_paise) then
    raise exception using errcode='23514',message='Execution price does not satisfy the Intraday LIMIT price';
  end if;

  v_gross:=p_execution_price_paise::numeric*v_order.quantity::numeric;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception using errcode='22003',message='Intraday LIMIT fill value exceeds supported limits';
  end if;
  v_breakdown:=public._paper_nse_cash_equity_charges(v_gross,'INTRADAY',v_order.side);
  v_charges:=(v_breakdown->>'total_charges_paise')::bigint;
  v_net:=case when v_order.side='BUY' then v_gross+v_charges else v_gross-v_charges end;
  if v_order.side='SELL' and v_net<=0 then
    raise exception using errcode='22003',message='Intraday LIMIT SELL charges must be lower than execution proceeds';
  end if;
  v_cash_delta:=case when v_order.side='BUY' then -v_net else v_net end;
  v_limit_gross:=v_order.limit_price_paise::bigint*v_order.quantity::bigint;
  v_expected_reserve:=v_limit_gross+
    (public._paper_nse_cash_equity_charges(v_limit_gross,'INTRADAY','BUY')->>'total_charges_paise')::bigint;
  v_cash:=v_account.cash_paise;
  v_reserved_cash:=v_account.reserved_cash_paise;
  v_aggregate_realized:=v_account.realized_pnl_paise;
  v_intraday_realized:=v_account.intraday_realized_pnl_paise;

  select * into v_position from public.paper_equity_positions
   where user_id=v_order.user_id and product='INTRADAY'
     and instrument_key=v_order.instrument_key for update;
  if v_order.side='BUY' then
    if v_order.reserved_cash_paise<=0
       or v_order.reserved_cash_paise<>v_expected_reserve
       or v_reserved_cash<v_order.reserved_cash_paise
       or v_cash-v_reserved_cash-v_account.reserved_margin_paise+v_order.reserved_cash_paise<v_net then
      raise exception using errcode='23514',message='Intraday LIMIT BUY cash reservation is inconsistent';
    end if;
    if found then
      if v_position.quantity+v_order.quantity>1000000 then
        raise exception using errcode='22003',message='Intraday position quantity exceeds supported limit';
      end if;
      v_new_qty:=v_position.quantity+v_order.quantity;
      v_new_cost:=v_position.cost_basis_paise+v_net;
      if v_new_cost>9007199254740991 then
        raise exception using errcode='22003',message='Intraday position cost exceeds supported limit';
      end if;
      update public.paper_equity_positions set quantity=v_new_qty,
        cost_basis_paise=v_new_cost,average_price_paise=round(v_new_cost::numeric/v_new_qty)::bigint,
        trading_symbol=coalesce(v_order.trading_symbol,trading_symbol),
        exchange=coalesce(v_order.exchange,exchange),updated_at=v_now
       where user_id=v_order.user_id and product='INTRADAY' and instrument_key=v_order.instrument_key;
    else
      if (select count(*) from public.paper_equity_positions
           where user_id=v_order.user_id and quantity>0)>=50 then
        raise exception using errcode='23514',message='Paper portfolio is limited to 50 open positions';
      end if;
      insert into public.paper_equity_positions(user_id,product,instrument_key,trading_symbol,
        exchange,quantity,average_price_paise,cost_basis_paise,reserved_quantity,updated_at)
      values(v_order.user_id,'INTRADAY',v_order.instrument_key,v_order.trading_symbol,
        v_order.exchange,v_order.quantity,round(v_net::numeric/v_order.quantity)::bigint,v_net,0,v_now);
    end if;
    v_cash:=v_cash-v_net;
    v_reserved_cash:=v_reserved_cash-v_order.reserved_cash_paise;
  else
    if not found or v_order.reserved_quantity<>v_order.quantity
       or v_position.reserved_quantity<v_order.reserved_quantity
       or v_order.reserved_cash_paise<>0 then
      raise exception using errcode='23514',message='Intraday LIMIT SELL share reservation is inconsistent';
    end if;
    v_allocated_cost:=case when v_order.quantity=v_position.quantity then v_position.cost_basis_paise
      else floor((v_position.cost_basis_paise::numeric*v_order.quantity
        +floor(v_position.quantity/2))/v_position.quantity)::bigint end;
    v_remaining_cost:=v_position.cost_basis_paise-v_allocated_cost;
    v_remaining_qty:=v_position.quantity-v_order.quantity;
    v_realized:=v_net-v_allocated_cost;
    if v_remaining_qty=0 then
      delete from public.paper_equity_positions where user_id=v_order.user_id
        and product='INTRADAY' and instrument_key=v_order.instrument_key;
    else
      update public.paper_equity_positions set quantity=v_remaining_qty,
        cost_basis_paise=v_remaining_cost,
        average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
        reserved_quantity=reserved_quantity-v_order.reserved_quantity,updated_at=v_now
       where user_id=v_order.user_id and product='INTRADAY' and instrument_key=v_order.instrument_key;
    end if;
    v_cash:=v_cash+v_net;
    v_aggregate_realized:=v_aggregate_realized+v_realized;
    v_intraday_realized:=v_intraday_realized+v_realized;
  end if;
  if v_cash<0 or v_cash>9007199254740991
     or v_reserved_cash<0 or v_reserved_cash+v_account.reserved_margin_paise>v_cash
     or abs(v_aggregate_realized)>9007199254740991
     or abs(v_intraday_realized)>9007199254740991 then
    raise exception using errcode='22003',message='Intraday LIMIT account totals exceed supported limits';
  end if;

  update public.paper_accounts set cash_paise=v_cash,reserved_cash_paise=v_reserved_cash,
    realized_pnl_paise=v_aggregate_realized,intraday_realized_pnl_paise=v_intraday_realized,
    version=version+1,updated_at=v_now where user_id=v_order.user_id;
  update public.paper_orders set status='FILLED',execution_price_paise=p_execution_price_paise,
    gross_paise=v_gross,charges_paise=v_charges,charges_breakdown=v_breakdown,
    cash_delta_paise=v_cash_delta,realized_pnl_paise=v_realized,quote_timestamp_ms=p_quote_timestamp_ms,
    quote_age_ms=v_age,reservation_released=true,worker_execution=true,
    filled_at=v_now,updated_at=v_now where order_id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status','FILLED',
    'execution_price_paise',p_execution_price_paise,'gross_paise',v_gross,
    'charges_paise',v_charges,'charges_breakdown',v_breakdown,'cash_delta_paise',v_cash_delta,
    'realized_pnl_paise',v_realized,'cash_paise',v_cash,
    'reserved_cash_paise',v_reserved_cash,'simulation_only',true);
end;
$$;


-- Reject minimum-fee SELLs whose simulated net proceeds would be zero or negative.
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
    raise exception using errcode='22003',message='NSE cash SELL charges must be lower than execution proceeds';
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
