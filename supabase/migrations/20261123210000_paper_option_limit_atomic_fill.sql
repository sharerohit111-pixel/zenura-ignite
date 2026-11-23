-- DRAFT ONLY. Atomic NSE long-options LIMIT partial/full fill settlement.
-- SQL computes incremental order charges and is the sole settlement authority.
-- No worker, order route, UI enablement, production deployment or live broker order is introduced.

create or replace function public.execute_paper_option_limit_fill(
  p_order_id text,
  p_execution_id text,
  p_fill_sequence integer,
  p_fill_quantity integer,
  p_execution_price_paise bigint,
  p_bid_price_paise bigint,
  p_ask_price_paise bigint,
  p_bid_quantity integer,
  p_ask_quantity integer,
  p_quote_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_account public.paper_accounts%rowtype;
  v_order public.paper_option_limit_orders%rowtype;
  v_position public.paper_derivative_positions%rowtype;
  v_has_position boolean := false;
  v_existing_fill public.paper_option_limit_fills%rowtype;
  v_server_now timestamptz;
  v_server_now_ms bigint;
  v_local_date date;
  v_local_minute integer;
  v_session public.paper_exchange_sessions%rowtype;
  v_next_sequence integer;
  v_gross_numeric numeric;
  v_gross bigint;
  v_cumulative_gross bigint;
  v_exchange_fee bigint;
  v_ipft bigint;
  v_sebi bigint;
  v_stamp bigint;
  v_stt bigint;
  v_gst bigint;
  v_total_charges bigint;
  v_incremental_charges bigint;
  v_fill_debit bigint;
  v_fill_credit bigint;
  v_new_cash bigint;
  v_new_reserved_cash bigint;
  v_account_reserved_cash bigint;
  v_new_filled integer;
  v_new_remaining integer;
  v_new_status text;
  v_average_fill bigint;
  v_old_qty bigint := 0;
  v_old_basis bigint := 0;
  v_closed_basis bigint := 0;
  v_new_qty bigint;
  v_new_basis bigint;
  v_new_average bigint;
  v_new_reserved_close integer := 0;
  v_order_reserved_cash_release bigint := 0;
  v_order_reserved_close_release integer := 0;
  v_order_reserved_cash bigint;
  v_realized bigint := 0;
  v_new_realized bigint;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_execution_id is null or length(p_execution_id) not between 1 and 160
     or p_fill_sequence is null or p_fill_sequence<1
     or p_fill_quantity is null or p_fill_quantity<1
     or p_execution_price_paise is null or p_execution_price_paise<1
     or p_bid_price_paise is null or p_bid_price_paise<1
     or p_ask_price_paise is null or p_ask_price_paise<1
     or p_bid_quantity is null or p_bid_quantity<1
     or p_ask_quantity is null or p_ask_quantity<1
     or p_bid_price_paise>p_ask_price_paise
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms<=0
     or p_now_ms is null or p_now_ms<=0 then
    raise exception 'Invalid NSE Options LIMIT fill input.' using errcode='22023';
  end if;

  -- Resolve owner only to lock the shared account first. Recheck ownership below.
  select user_id into v_user_id
    from public.paper_option_limit_orders
   where order_id=p_order_id;
  if not found then
    raise exception 'Options LIMIT order was not found.' using errcode='P0002';
  end if;

  select * into v_account
    from public.paper_accounts
   where user_id=v_user_id
   for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;

  select * into v_order
    from public.paper_option_limit_orders
   where order_id=p_order_id and user_id=v_user_id
   for update;
  if not found then
    raise exception 'Options LIMIT order ownership changed.' using errcode='P0002';
  end if;

  -- Exact fill replay is checked before quote freshness so a retry remains
  -- idempotent after the original provider snapshot has aged out.
  select * into v_existing_fill
    from public.paper_option_limit_fills
   where order_id=p_order_id and execution_id=p_execution_id;
  if found then
    if v_existing_fill.fill_sequence<>p_fill_sequence
       or v_existing_fill.fill_quantity<>p_fill_quantity
       or v_existing_fill.execution_price_paise<>p_execution_price_paise
       or v_existing_fill.bid_price_paise<>p_bid_price_paise
       or v_existing_fill.ask_price_paise<>p_ask_price_paise
       or v_existing_fill.bid_quantity<>p_bid_quantity
       or v_existing_fill.ask_quantity<>p_ask_quantity
       or v_existing_fill.quote_timestamp_ms<>p_quote_timestamp_ms then
      raise exception 'Options LIMIT execution ID was replayed with changed fill details.' using errcode='23505';
    end if;
    return jsonb_build_object(
      'order_id',p_order_id,'execution_id',p_execution_id,
      'status',v_order.status,'filled_quantity',v_order.filled_quantity,
      'remaining_quantity',v_order.remaining_quantity,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  v_server_now:=clock_timestamp();
  v_server_now_ms:=floor(extract(epoch from v_server_now)*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000
     or not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception 'A fresh NSE executable quote and current server clock are required.' using errcode='22023';
  end if;

  if v_order.status not in ('PENDING','PARTIALLY_FILLED')
     or v_order.remaining_quantity<1
     or p_fill_quantity>v_order.remaining_quantity
     or v_order.expires_at<=v_server_now then
    raise exception 'Options LIMIT order is not fillable or fill exceeds remaining quantity.' using errcode='23514';
  end if;
  if v_order.expiry<(v_server_now at time zone 'Asia/Kolkata')::date
     or v_server_now>=((v_order.expiry + time '15:30') at time zone 'Asia/Kolkata') then
    raise exception 'Expired NSE option contracts cannot be filled.' using errcode='22023';
  end if;

  if p_execution_price_paise%v_order.tick_size_paise<>0
     or p_bid_price_paise%v_order.tick_size_paise<>0
     or p_ask_price_paise%v_order.tick_size_paise<>0 then
    raise exception 'Options LIMIT executable quote prices are off tick.' using errcode='22023';
  end if;
  if (v_order.side='BUY' and
       (p_execution_price_paise>v_order.limit_price_paise
        or p_execution_price_paise<>p_ask_price_paise
        or p_ask_quantity<p_fill_quantity))
     or (v_order.side='SELL' and
       (p_execution_price_paise<v_order.limit_price_paise
        or p_execution_price_paise<>p_bid_price_paise
        or p_bid_quantity<p_fill_quantity)) then
    raise exception 'Options LIMIT fill does not match limit price, executable side and displayed depth.' using errcode='23514';
  end if;

  -- Fail closed unless a verified NSE session is currently open.
  v_local_date:=(v_server_now at time zone 'Asia/Kolkata')::date;
  v_local_minute:=extract(hour from (v_server_now at time zone 'Asia/Kolkata'))::integer*60
    +extract(minute from (v_server_now at time zone 'Asia/Kolkata'))::integer;
  select * into v_session
    from public.paper_exchange_sessions
   where exchange='NSE' and session_date=v_local_date
     and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
     and verified_at<=v_server_now
     and length(btrim(source_reference)) between 1 and 500
     and source_sha256 ~ '^[a-f0-9]{64}$'
     and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)';
  if not found or v_local_minute<v_session.open_minute
     or v_local_minute>=v_session.close_minute then
    raise exception 'A verified open NSE session is required for Options LIMIT fills.' using errcode='22023';
  end if;

  select coalesce(max(fill_sequence),0)+1 into v_next_sequence
    from public.paper_option_limit_fills where order_id=p_order_id;
  if p_fill_sequence<>v_next_sequence then
    raise exception 'Options LIMIT fill sequence is not the next expected sequence.' using errcode='23514';
  end if;

  v_gross_numeric:=p_execution_price_paise::numeric*p_fill_quantity::numeric;
  if v_gross_numeric<=0 or v_gross_numeric>9007199254740991 then
    raise exception 'Options LIMIT fill notional exceeds safe integer limits.' using errcode='22003';
  end if;
  v_gross:=v_gross_numeric::bigint;
  v_cumulative_gross:=v_order.cumulative_gross_paise+v_gross;
  if v_cumulative_gross>9007199254740991 then
    raise exception 'Options LIMIT cumulative turnover exceeds safe integer limits.' using errcode='22003';
  end if;

  -- Compute cumulative charges once per logical order. Each fill books only
  -- the delta; brokerage is not charged again for every partial execution.
  v_exchange_fee:=floor(v_cumulative_gross::numeric*0.0003552+0.5)::bigint;
  v_ipft:=floor(v_cumulative_gross::numeric*0.000000001+0.5)::bigint;
  v_sebi:=floor(v_cumulative_gross::numeric*0.000001+0.5)::bigint;
  v_stamp:=case when v_order.side='BUY'
    then floor(v_cumulative_gross::numeric*0.00003+0.5)::bigint else 0 end;
  v_stt:=case when v_order.side='SELL'
    then floor(v_cumulative_gross::numeric*0.0015+0.5)::bigint else 0 end;
  v_gst:=floor((2000+v_exchange_fee+v_ipft)::numeric*0.18+0.5)::bigint;
  v_total_charges:=2000+v_exchange_fee+v_ipft+v_sebi+v_stamp+v_stt+v_gst;
  v_incremental_charges:=v_total_charges-v_order.cumulative_charges_paise;
  if v_incremental_charges<0 or v_total_charges>9007199254740991 then
    raise exception 'Options LIMIT incremental charges are invalid.' using errcode='22003';
  end if;

  v_new_filled:=v_order.filled_quantity+p_fill_quantity;
  v_new_remaining:=v_order.remaining_quantity-p_fill_quantity;
  v_new_status:=case when v_new_remaining=0 then 'FILLED' else 'PARTIALLY_FILLED' end;
  v_average_fill:=floor(
    (coalesce(v_order.average_fill_price_paise,0)::numeric*v_order.filled_quantity
      +p_execution_price_paise::numeric*p_fill_quantity)
    /v_new_filled
  )::bigint;

  select * into v_position
    from public.paper_derivative_positions
   where user_id=v_user_id and instrument_key=v_order.instrument_key
   for update;
  v_has_position:=found;

  if v_order.side='BUY' then
    if v_has_position then
      if v_position.instrument_type<>v_order.instrument_type
         or v_position.exchange is distinct from v_order.exchange
         or v_position.segment is distinct from v_order.segment
         or v_position.expiry is distinct from v_order.expiry
         or v_position.lot_size is distinct from v_order.lot_size
         or v_position.net_quantity<=0
         or v_position.reserved_quantity<0
         or v_position.reserved_quantity>v_position.net_quantity then
        raise exception 'Options LIMIT BUY position metadata or long-only invariant changed.' using errcode='23514';
      end if;
      v_old_qty:=v_position.net_quantity;
      v_old_basis:=v_position.cost_basis_paise;
    else
      select count(*) into v_next_sequence
        from public.paper_derivative_positions
       where user_id=v_user_id and net_quantity>0;
      if v_next_sequence>=50 then
        raise exception 'Derivative portfolio is limited to 50 open positions.' using errcode='23514';
      end if;
    end if;

    v_new_qty:=v_old_qty+p_fill_quantity;
    v_new_basis:=v_old_basis+v_gross+v_incremental_charges;
    if v_new_qty>1000000 or v_new_basis>9007199254740991 then
      raise exception 'Options LIMIT BUY position exceeds supported limits.' using errcode='22003';
    end if;
    v_new_average:=floor(v_new_basis::numeric/v_new_qty+0.5)::bigint;

    v_fill_debit:=v_gross+v_incremental_charges;
    if v_order.reserved_cash_paise<v_fill_debit
       or v_account.reserved_cash_paise<v_order.reserved_cash_paise then
      raise exception 'Options LIMIT BUY cash reservation cannot cover this fill.' using errcode='23514';
    end if;
    if v_new_remaining=0 then
      v_order_reserved_cash_release:=v_order.reserved_cash_paise;
      v_new_reserved_cash:=0;
    else
      v_order_reserved_cash_release:=v_fill_debit;
      v_new_reserved_cash:=v_order.reserved_cash_paise-v_fill_debit;
    end if;
    v_new_cash:=v_account.cash_paise-v_fill_debit;
    v_account_reserved_cash:=v_account.reserved_cash_paise-v_order_reserved_cash_release;
    if v_new_cash<0 or v_account_reserved_cash<0
       or v_account_reserved_cash+v_account.reserved_margin_paise>v_new_cash then
      raise exception 'Options LIMIT BUY fill violates account cash/reservation invariants.' using errcode='23514';
    end if;

    if v_has_position then
      update public.paper_derivative_positions
         set net_quantity=v_new_qty,cost_basis_paise=v_new_basis,
             average_price_paise=v_new_average,updated_at=now()
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    else
      insert into public.paper_derivative_positions(
        user_id,instrument_key,trading_symbol,segment,exchange,instrument_type,expiry,
        lot_size,net_quantity,average_price_paise,cost_basis_paise,reserved_quantity,updated_at
      ) values (
        v_user_id,v_order.instrument_key,v_order.trading_symbol,v_order.segment,
        v_order.exchange,v_order.instrument_type,v_order.expiry,v_order.lot_size,
        v_new_qty,v_new_average,v_new_basis,0,now()
      );
    end if;

    update public.paper_accounts
       set cash_paise=v_new_cash,reserved_cash_paise=v_account_reserved_cash,
           version=version+1,updated_at=now()
     where user_id=v_user_id;
  else
    if not v_has_position
       or v_position.instrument_type<>v_order.instrument_type
       or v_position.exchange is distinct from v_order.exchange
       or v_position.segment is distinct from v_order.segment
       or v_position.expiry is distinct from v_order.expiry
       or v_position.lot_size is distinct from v_order.lot_size
       or v_position.net_quantity<=0
       or v_order.reserved_close_quantity<p_fill_quantity
       or v_position.reserved_quantity<p_fill_quantity
       or v_position.net_quantity<p_fill_quantity then
      raise exception 'Options LIMIT SELL fill exceeds its reserved long position.' using errcode='23514';
    end if;

    v_old_qty:=v_position.net_quantity;
    v_old_basis:=v_position.cost_basis_paise;
    v_closed_basis:=case when p_fill_quantity=v_old_qty then v_old_basis
      else floor((v_old_basis::numeric*p_fill_quantity+floor(v_old_qty::numeric/2))/v_old_qty)::bigint end;
    v_new_qty:=v_old_qty-p_fill_quantity;
    v_new_basis:=v_old_basis-v_closed_basis;
    v_new_reserved_close:=v_position.reserved_quantity-p_fill_quantity;
    v_realized:=v_gross-v_closed_basis-v_incremental_charges;
    v_fill_credit:=v_gross-v_incremental_charges;
    v_new_cash:=v_account.cash_paise+v_fill_credit;
    v_new_realized:=v_account.realized_pnl_paise+v_realized;
    if abs(v_new_cash::numeric)>9007199254740991
       or abs(v_new_realized::numeric)>9007199254740991
       or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_new_cash then
      raise exception 'Options LIMIT SELL fill violates account cash/realized-P&L invariants.' using errcode='23514';
    end if;
    if v_new_remaining=0 then
      v_order_reserved_close_release:=v_order.reserved_close_quantity;
    else
      v_order_reserved_close_release:=p_fill_quantity;
    end if;

    if v_new_qty=0 then
      if v_new_reserved_close<>0 then
        raise exception 'Other Options close reservations remain on a fully closed position.' using errcode='23514';
      end if;
      update public.paper_option_limit_orders
         set status='FILLED',filled_quantity=v_new_filled,remaining_quantity=0,
             average_fill_price_paise=v_average_fill,cumulative_gross_paise=v_cumulative_gross,
             cumulative_charges_paise=v_total_charges,reserved_cash_paise=0,
             reserved_close_quantity=0,reservation_released=true,updated_at=now()
       where order_id=p_order_id;
      delete from public.paper_derivative_positions
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    else
      update public.paper_derivative_positions
         set net_quantity=v_new_qty,cost_basis_paise=v_new_basis,
             average_price_paise=case when v_new_qty>0 then floor(v_new_basis::numeric/v_new_qty+0.5)::bigint else 0 end,
             reserved_quantity=v_new_reserved_close,updated_at=now()
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    end if;

    update public.paper_accounts
       set cash_paise=v_new_cash,realized_pnl_paise=v_new_realized,
           version=version+1,updated_at=now()
     where user_id=v_user_id;
  end if;

  -- For a partial BUY, the remaining reservation is reduced by actual spend;
  -- the final fill releases any unused residual. For SELL, only filled units
  -- leave the reserved-close quantity.
  if v_order.side='BUY' then
    update public.paper_option_limit_orders
       set status=v_new_status,filled_quantity=v_new_filled,remaining_quantity=v_new_remaining,
           average_fill_price_paise=v_average_fill,cumulative_gross_paise=v_cumulative_gross,
           cumulative_charges_paise=v_total_charges,reserved_cash_paise=v_new_reserved_cash,
           reserved_close_quantity=0,reservation_released=(v_new_remaining=0),
           updated_at=now()
     where order_id=p_order_id;
  elsif v_new_qty>0 then
    update public.paper_option_limit_orders
       set status=v_new_status,filled_quantity=v_new_filled,remaining_quantity=v_new_remaining,
           average_fill_price_paise=v_average_fill,cumulative_gross_paise=v_cumulative_gross,
           cumulative_charges_paise=v_total_charges,reserved_cash_paise=0,
           reserved_close_quantity=case when v_new_remaining=0 then 0 else v_order.reserved_close_quantity-p_fill_quantity end,
           reservation_released=(v_new_remaining=0),updated_at=now()
     where order_id=p_order_id;
  end if;

  insert into public.paper_option_limit_fills(
    order_id,execution_id,fill_sequence,fill_quantity,execution_price_paise,
    gross_paise,incremental_charges_paise,realized_pnl_paise,
    bid_price_paise,bid_quantity,ask_price_paise,ask_quantity,
    quote_timestamp_ms,simulation_only,created_at
  ) values (
    p_order_id,p_execution_id,p_fill_sequence,p_fill_quantity,p_execution_price_paise,
    v_gross,v_incremental_charges,v_realized,
    p_bid_price_paise,p_bid_quantity,p_ask_price_paise,p_ask_quantity,
    p_quote_timestamp_ms,true,now()
  );

  return jsonb_build_object(
    'order_id',p_order_id,'execution_id',p_execution_id,'status',v_new_status,
    'filled_quantity',v_new_filled,'remaining_quantity',v_new_remaining,
    'gross_paise',v_gross,'incremental_charges_paise',v_incremental_charges,
    'realized_pnl_paise',v_realized,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

revoke all on function public.execute_paper_option_limit_fill(
  text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.execute_paper_option_limit_fill(
  text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint
) to service_role;
