-- Prevent a Crypto LIMIT BUY fill from consuming cash reserved for other orders
-- when the USD/INR conversion rate rises after order placement.
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
    if v_account.reserved_cash<v_order.reserved_amount
       or v_total>v_order.reserved_amount
       or v_account.cash_balance<v_total then
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
      -- Release this order's reservation before DELETE. The immutable guard
      -- must still reject any unrelated delete with a live reservation.
      update public.paper_crypto_positions
         set reserved_quantity=reserved_quantity-v_order.quantity,updated_at=now()
       where user_id=p_user_id and symbol=v_order.symbol
         and reserved_quantity>=v_order.quantity;
      if not found then
        raise exception 'Crypto LIMIT position reservation could not be released.' using errcode='23514';
      end if;
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

revoke all on function public.fill_paper_crypto_limit_order(uuid,uuid,numeric,numeric,numeric,bigint) from public,anon,authenticated;
grant execute on function public.fill_paper_crypto_limit_order(uuid,uuid,numeric,numeric,numeric,bigint) to service_role;
