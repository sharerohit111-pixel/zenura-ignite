-- DRAFT ONLY — atomically mirror cash-equity order lifecycle into immutable audit tables.
-- A deferred constraint trigger observes the final account/order state at transaction commit.
-- This covers existing full-fill MARKET/LIMIT RPCs without changing their execution arithmetic.
-- Partial fills remain unsupported until the order lifecycle itself is extended.

create or replace function public._paper_record_equity_order_audit()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cash bigint;
  v_reserved_cash bigint;
  v_fill_id uuid;
  v_execution_id text;
begin
  -- Only cash-equity orders; derivative orders use their separate tables.
  if NEW.product not in ('DELIVERY','INTRADAY')
     or NEW.exchange not in ('NSE','BSE') then
    return NEW;
  end if;

  select cash_paise,reserved_cash_paise
    into v_cash,v_reserved_cash
    from public.paper_accounts
   where user_id=NEW.user_id;
  if not found then
    raise exception using errcode='P0002',message='Equity audit ledger cannot find the paper account';
  end if;

  -- LIMIT submit: record the cash reservation after the submit RPC has updated the account.
  if TG_OP='INSERT' and NEW.status='PENDING' and NEW.order_type='LIMIT' then
    insert into public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,
      reserved_cash_after_paise,metadata
    ) values (
      NEW.user_id,NEW.order_id,NEW.order_id||':reservation:create',
      'RESERVATION_CREATE',0,NEW.reserved_cash_paise,v_cash,v_reserved_cash,
      jsonb_build_object('order_type',NEW.order_type,'side',NEW.side,
        'product',NEW.product,'quantity',NEW.quantity,
        'reserved_quantity',NEW.reserved_quantity,'simulation_only',true)
    ) on conflict(user_id,event_key) do nothing;
    return NEW;
  end if;

  -- A pending LIMIT order cancelled/rejected: the RPC releases its reservation
  -- before this deferred trigger runs, so the snapshots reflect post-release state.
  if TG_OP='UPDATE' and OLD.status='PENDING'
     and NEW.status in ('CANCELLED','REJECTED') then
    insert into public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,
      reserved_cash_after_paise,metadata
    ) values (
      NEW.user_id,NEW.order_id,NEW.order_id||':reservation:release',
      'RESERVATION_RELEASE',0,-OLD.reserved_cash_paise,v_cash,v_reserved_cash,
      jsonb_build_object('order_type',NEW.order_type,'side',NEW.side,
        'product',NEW.product,'quantity',NEW.quantity,
        'released_quantity',OLD.reserved_quantity,'simulation_only',true)
    ) on conflict(user_id,event_key) do nothing;
    return NEW;
  end if;

  -- LIMIT PENDING -> FILLED. MARKET fills are written by the dedicated
  -- execute_paper_market_order wrapper migration to avoid duplicate audit rows.
  if TG_OP='UPDATE' and OLD.status='PENDING'
     and NEW.status='FILLED' and NEW.order_type='LIMIT' then
    if NEW.execution_price_paise is null or NEW.execution_price_paise<=0
       or NEW.gross_paise is null or NEW.gross_paise<=0
       or NEW.charges_paise is null or NEW.charges_paise<0
       or NEW.charges_breakdown is null
       or NEW.cash_delta_paise is null or NEW.cash_delta_paise=0
       or NEW.quote_timestamp_ms is null or NEW.quote_timestamp_ms<=0
       or NEW.filled_at is null then
      raise exception using errcode='23514',
        message='Filled cash-equity order is missing immutable execution or fee fields';
    end if;
    if (NEW.side='BUY' and NEW.cash_delta_paise>=0)
       or (NEW.side='SELL' and NEW.cash_delta_paise<=0) then
      raise exception using errcode='23514',
        message='Cash-equity fill cash delta does not match order side';
    end if;

    v_execution_id:=NEW.order_id||':FULL';
    insert into public.paper_equity_fills(
      user_id,order_id,execution_id,instrument_key,exchange,product,side,
      quantity,execution_price_paise,gross_paise,charges_paise,
      charges_breakdown,cash_delta_paise,realized_pnl_paise,
      quote_timestamp_ms,filled_at
    ) values (
      NEW.user_id,NEW.order_id,v_execution_id,NEW.instrument_key,NEW.exchange,
      NEW.product,NEW.side,NEW.quantity,NEW.execution_price_paise,NEW.gross_paise,
      NEW.charges_paise,NEW.charges_breakdown,NEW.cash_delta_paise,
      NEW.realized_pnl_paise,NEW.quote_timestamp_ms,NEW.filled_at
    ) on conflict(order_id,execution_id) do nothing;

    select fill_id into v_fill_id
      from public.paper_equity_fills
     where order_id=NEW.order_id and execution_id=v_execution_id;
    if v_fill_id is null then
      raise exception using errcode='23514',message='Cash-equity fill audit row was not persisted';
    end if;

    -- A LIMIT fill consumes its reservation before the trade cash movement.
    -- Reconstruct the pre-trade snapshot from the final account and order cash delta.
    if TG_OP='UPDATE' and OLD.status='PENDING' and NEW.order_type='LIMIT' then
      insert into public.paper_equity_cash_ledger(
        user_id,order_id,event_key,event_type,cash_delta_paise,
        reserved_cash_delta_paise,cash_balance_after_paise,
        reserved_cash_after_paise,metadata
      ) values (
        NEW.user_id,NEW.order_id,NEW.order_id||':reservation:consume',
        'RESERVATION_CONSUME',0,-OLD.reserved_cash_paise,
        v_cash-NEW.cash_delta_paise,v_reserved_cash+OLD.reserved_cash_paise,
        jsonb_build_object('order_type',NEW.order_type,'side',NEW.side,
          'product',NEW.product,'quantity',NEW.quantity,
          'consumed_quantity',OLD.reserved_quantity,'simulation_only',true)
      ) on conflict(user_id,event_key) do nothing;
    end if;

    insert into public.paper_equity_cash_ledger(
      user_id,order_id,fill_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,
      reserved_cash_after_paise,metadata
    ) values (
      NEW.user_id,NEW.order_id,v_fill_id,NEW.order_id||':trade:cash',
      case when NEW.cash_delta_paise<0 then 'TRADE_DEBIT' else 'TRADE_CREDIT' end,
      NEW.cash_delta_paise,0,v_cash,v_reserved_cash,
      jsonb_build_object('execution_id',v_execution_id,'exchange',NEW.exchange,
        'product',NEW.product,'side',NEW.side,'quantity',NEW.quantity,
        'gross_paise',NEW.gross_paise,'charges_paise',NEW.charges_paise,
        'realized_pnl_paise',NEW.realized_pnl_paise,'simulation_only',true)
    ) on conflict(user_id,event_key) do nothing;
  end if;

  return NEW;
end;
$$;

drop trigger if exists paper_equity_orders_audit_deferred on public.paper_orders;
create constraint trigger paper_equity_orders_audit_deferred
  after insert or update on public.paper_orders
  deferrable initially deferred
  for each row execute function public._paper_record_equity_order_audit();

revoke all on function public._paper_record_equity_order_audit()
  from public,anon,authenticated,service_role;
