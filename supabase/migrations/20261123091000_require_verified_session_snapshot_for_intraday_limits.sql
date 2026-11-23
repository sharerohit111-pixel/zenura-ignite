-- Only calendar rows imported from a verified, hashed exchange snapshot may open or fill Intraday LIMIT orders.

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
     and verified_at<=v_now and length(btrim(source_reference))>0 and source_sha256 is not null;
  if not found or v_minute<v_session.open_minute or v_minute>=v_session.close_minute then
    raise exception using errcode='23514',message='No verified open exchange session for Intraday LIMIT';
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505',message='Order ID already exists';
  end if;

  if p_exchange is null or p_exchange not in ('NSE','BSE') then
    raise exception using errcode='22023',message='BSE Intraday LIMIT settlement is disabled until verified scrip-group charges are available';
  end if;
  v_gross:=p_limit_price_paise::bigint*p_quantity::bigint;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception using errcode='22003',message='Intraday LIMIT reservation exceeds supported limits';
  end if;
  v_breakdown:=public._paper_cash_equity_charges(p_instrument_key,p_exchange,v_gross,'INTRADAY','BUY');
  if p_side='SELL' and (public._paper_cash_equity_charges(p_instrument_key,p_exchange,v_gross,'INTRADAY','SELL')->>'total_charges_paise')::bigint>=v_gross then
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

create or replace function public.expire_paper_intraday_limit_orders(p_batch_size integer default 100)
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_order record;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_session public.paper_exchange_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_today date;
  v_minute integer;
  v_expired integer:=0;
  v_expire boolean;
begin
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception using errcode='22023',message='Invalid expiry batch size';
  end if;
  v_today:=(v_now at time zone 'Asia/Kolkata')::date;
  v_minute:=extract(hour from v_now at time zone 'Asia/Kolkata')::integer*60
            +extract(minute from v_now at time zone 'Asia/Kolkata')::integer;

  for v_order in
    select order_id,user_id,exchange,created_at from public.paper_orders
     where product='INTRADAY' and order_type='LIMIT' and status='PENDING'
     order by created_at,order_id limit p_batch_size
  loop
    v_expire:=(v_order.created_at at time zone 'Asia/Kolkata')::date<v_today
      or (v_order.created_at at time zone 'Asia/Kolkata')::date>v_today;
    if not v_expire then
      select * into v_session from public.paper_exchange_sessions
       where exchange=v_order.exchange and session_date=v_today
         and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
         and verified_at<=v_now and length(btrim(source_reference))>0 and source_sha256 is not null;
      v_expire:=not found or v_minute>=v_session.close_minute
        or v_minute<v_session.open_minute;
    end if;
    if not v_expire then continue; end if;

    select * into v_account from public.paper_accounts where user_id=v_order.user_id for update;
    if not found then raise exception using errcode='P0002',message='Paper account missing during Intraday LIMIT expiry'; end if;
    select * into v_order from public.paper_orders where order_id=v_order.order_id for update;
    if not found or v_order.status<>'PENDING' or v_order.reservation_released then continue; end if;
    if v_order.side='BUY' then
      if v_order.reserved_cash_paise<=0 or v_account.reserved_cash_paise<v_order.reserved_cash_paise then
        raise exception using errcode='23514',message='Intraday expiry BUY reservation is inconsistent';
      end if;
      update public.paper_accounts set reserved_cash_paise=reserved_cash_paise-v_order.reserved_cash_paise,
        version=version+1,updated_at=v_now where user_id=v_order.user_id;
    else
      select * into v_position from public.paper_equity_positions
       where user_id=v_order.user_id and product='INTRADAY' and instrument_key=v_order.instrument_key for update;
      if not found or v_order.reserved_quantity<>v_order.quantity
         or v_position.reserved_quantity<v_order.reserved_quantity then
        raise exception using errcode='23514',message='Intraday expiry SELL reservation is inconsistent';
      end if;
      update public.paper_equity_positions set reserved_quantity=reserved_quantity-v_order.reserved_quantity,
        updated_at=v_now where user_id=v_order.user_id and product='INTRADAY' and instrument_key=v_order.instrument_key;
      update public.paper_accounts set version=version+1,updated_at=v_now where user_id=v_order.user_id;
    end if;
    update public.paper_orders set status='CANCELLED',reservation_released=true,
      cancelled_at=v_now,updated_at=v_now where order_id=v_order.order_id;
    v_expired:=v_expired+1;
  end loop;
  return v_expired;
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
     and length(btrim(source_reference))>0 and source_sha256 is not null;
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
  if v_order.exchange is null or v_order.exchange not in ('NSE','BSE') then
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
  v_breakdown:=public._paper_cash_equity_charges(v_order.instrument_key,v_order.exchange,v_gross,'INTRADAY',v_order.side);
  v_charges:=(v_breakdown->>'total_charges_paise')::bigint;
  v_net:=case when v_order.side='BUY' then v_gross+v_charges else v_gross-v_charges end;
  if v_order.side='SELL' and v_net<=0 then
    raise exception using errcode='22003',message='Intraday LIMIT SELL charges must be lower than execution proceeds';
  end if;
  v_cash_delta:=case when v_order.side='BUY' then -v_net else v_net end;
  v_limit_gross:=v_order.limit_price_paise::bigint*v_order.quantity::bigint;
  v_expected_reserve:=v_limit_gross+
    (public._paper_cash_equity_charges(v_order.instrument_key,v_order.exchange,v_limit_gross,'INTRADAY','BUY')->>'total_charges_paise')::bigint;
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
