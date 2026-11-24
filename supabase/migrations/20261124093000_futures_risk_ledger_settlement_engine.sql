-- Futures risk ledger and settlement RPCs. Draft-only; disposable PostgreSQL CI only.
-- All money is integer paise. No exchange/broker orders are submitted by these RPCs.

-- Preserve genuine MTM losses even when they exceed available virtual cash.
-- The generated deficit is visible to risk controls; opening orders remain fail-closed.
alter table public.paper_accounts
  drop constraint if exists paper_accounts_cash_paise_check;
alter table public.paper_accounts
  drop constraint if exists paper_accounts_reserves_within_cash;
alter table public.paper_accounts
  add column if not exists margin_deficit_paise bigint
  generated always as (
    greatest(0::bigint, reserved_cash_paise + reserved_margin_paise - cash_paise)
  ) stored;

create table if not exists public.paper_futures_settlement_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null,
  last_settlement_date date,
  last_settlement_price_paise bigint,
  last_settlement_quantity integer,
  settlement_version bigint not null default 0 check (settlement_version >= 0),
  last_event_key text,
  updated_at timestamptz not null default now(),
  primary key(user_id,instrument_key),
  check (
    (last_settlement_date is null and last_settlement_price_paise is null
      and last_settlement_quantity is null and settlement_version=0)
    or
    (last_settlement_date is not null and last_settlement_price_paise>0
      and last_settlement_quantity is not null and settlement_version>0)
  )
);

create table if not exists public.paper_futures_risk_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_key text not null,
  initial_margin_paise bigint not null check (initial_margin_paise >= 0),
  maintenance_margin_paise bigint check (maintenance_margin_paise is null or maintenance_margin_paise > 0),
  risk_status text not null check (risk_status in ('HEALTHY','MARGIN_CALL','UNKNOWN','CLOSED')),
  provider text check (provider is null or length(provider) between 1 and 40),
  source_reference text check (source_reference is null or length(source_reference) between 1 and 500),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  source_timestamp_ms bigint check (source_timestamp_ms is null or source_timestamp_ms > 0),
  snapshot_version bigint not null default 1 check (snapshot_version > 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,instrument_key)
);

create table if not exists public.paper_futures_risk_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (length(event_key) between 1 and 200),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text not null check (event_type in (
    'DAILY_MTM','MARGIN_REFRESH','EXPIRY_SETTLEMENT','SIMULATED_SQUARE_OFF'
  )),
  instrument_key text not null,
  contract_expiry date not null,
  signed_quantity integer not null,
  price_paise bigint not null check (price_paise > 0),
  prior_basis_price_paise bigint,
  cash_delta_paise bigint not null,
  margin_delta_paise bigint not null,
  realized_pnl_delta_paise bigint not null,
  charges_paise bigint not null default 0 check (charges_paise >= 0),
  source_type text not null check (length(source_type) between 1 and 40),
  source_reference text not null check (length(source_reference) between 1 and 500),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_timestamp_ms bigint not null check (source_timestamp_ms > 0),
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  unique(user_id,event_key)
);

create index if not exists paper_futures_risk_events_user_created_idx
  on public.paper_futures_risk_events(user_id,created_at desc,event_id);
create index if not exists paper_futures_risk_events_instrument_idx
  on public.paper_futures_risk_events(user_id,instrument_key,created_at desc);

create or replace function public._reject_paper_futures_risk_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Futures risk events are append-only; post a compensating event.'
    using errcode='55000';
end;
$$;

drop trigger if exists paper_futures_risk_events_immutable on public.paper_futures_risk_events;
create trigger paper_futures_risk_events_immutable
before update or delete on public.paper_futures_risk_events
for each row execute function public._reject_paper_futures_risk_event_mutation();

alter table public.paper_futures_settlement_state enable row level security;
alter table public.paper_futures_risk_state enable row level security;
alter table public.paper_futures_risk_events enable row level security;

drop policy if exists paper_futures_settlement_state_select_own on public.paper_futures_settlement_state;
create policy paper_futures_settlement_state_select_own
  on public.paper_futures_settlement_state for select to authenticated
  using (auth.uid()=user_id);
drop policy if exists paper_futures_risk_state_select_own on public.paper_futures_risk_state;
create policy paper_futures_risk_state_select_own
  on public.paper_futures_risk_state for select to authenticated
  using (auth.uid()=user_id);
drop policy if exists paper_futures_risk_events_select_own on public.paper_futures_risk_events;
create policy paper_futures_risk_events_select_own
  on public.paper_futures_risk_events for select to authenticated
  using (auth.uid()=user_id);

revoke all on public.paper_futures_settlement_state,
  public.paper_futures_risk_state,public.paper_futures_risk_events
  from public,anon,authenticated;
grant select on public.paper_futures_settlement_state,
  public.paper_futures_risk_state,public.paper_futures_risk_events to authenticated;
grant all on public.paper_futures_settlement_state,
  public.paper_futures_risk_state,public.paper_futures_risk_events to service_role;
revoke all on function public._reject_paper_futures_risk_event_mutation() from public,anon,authenticated;

-- Post daily variation at an official NSE daily settlement price. The position
-- average becomes the current settlement-adjusted basis so the next close books
-- only movement since this settlement (daily MTM is not double-counted).
create or replace function public.post_paper_futures_daily_mtm(
  p_user_id uuid,
  p_instrument_key text,
  p_settlement_date date,
  p_settlement_price_paise bigint,
  p_event_key text,
  p_payload_sha256 text,
  p_source_reference text,
  p_source_sha256 text,
  p_source_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_state public.paper_futures_settlement_state%rowtype;
  v_existing public.paper_futures_risk_events%rowtype;
  v_now_ms bigint;
  v_prior_basis bigint;
  v_variation_numeric numeric;
  v_variation bigint;
  v_event_id uuid;
  v_version bigint;
begin
  if p_user_id is null
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_settlement_date is null
     or p_settlement_price_paise is null or p_settlement_price_paise<=0
     or p_event_key is null or length(p_event_key) not between 1 and 200
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_reference is null
     or lower(p_source_reference) !~ '^https://([a-z0-9-]+[.])*(nseindia[.]com|nsearchives[.]nseindia[.]com)(/|$)'
     or p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_timestamp_ms is null or p_source_timestamp_ms<=0
     or p_now_ms is null or p_now_ms<=0 then
    raise exception 'Invalid Futures daily MTM input or official source provenance.' using errcode='22023';
  end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_now_ms-p_now_ms)>2000
     or p_source_timestamp_ms>v_now_ms+2000
     or v_now_ms-p_source_timestamp_ms>172800000
     or p_settlement_date>(clock_timestamp() at time zone 'Asia/Kolkata')::date then
    raise exception 'Futures daily MTM source/date is stale or in the future.' using errcode='22023';
  end if;

  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then raise exception 'Paper Trading account is not initialized.' using errcode='P0002'; end if;

  select * into v_existing from public.paper_futures_risk_events
   where user_id=p_user_id and event_key=p_event_key;
  if found then
    if v_existing.payload_sha256<>p_payload_sha256 then
      raise exception 'Futures event key was reused with a different payload.' using errcode='23505';
    end if;
    return jsonb_build_object('event_id',v_existing.event_id,'event_type',v_existing.event_type,
      'cash_delta_paise',v_existing.cash_delta_paise,'idempotent_replay',true,'simulation_only',true);
  end if;

  select * into v_position from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  if not found then raise exception 'Open Futures position was not found.' using errcode='P0002'; end if;
  if v_position.exchange<>'NSE' then
    raise exception 'Daily settlement is blocked for non-NSE Futures until exchange-specific rules are integrated.' using errcode='22023';
  end if;
  if p_settlement_date>=v_position.expiry then
    raise exception 'Expiry-day Futures require final settlement, not daily MTM.' using errcode='22023';
  end if;
  if p_settlement_price_paise%v_position.tick_size_paise<>0 then
    raise exception 'Official Futures settlement price is off tick.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.paper_exchange_sessions s
     where s.exchange='NSE' and s.session_date=p_settlement_date
       and s.is_trading_day is true and s.session_kind in ('REGULAR','SPECIAL')
       and s.verified_at<=clock_timestamp()
       and s.source_sha256 ~ '^[a-f0-9]{64}$'
       and lower(s.source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)'
  ) then
    raise exception 'A verified NSE trading-session snapshot is required for daily MTM.' using errcode='22023';
  end if;

  select * into v_state from public.paper_futures_settlement_state
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  if found and v_state.last_settlement_date is not null
     and p_settlement_date<=v_state.last_settlement_date then
    raise exception 'Futures settlement date must advance monotonically.' using errcode='23514';
  end if;

  v_prior_basis:=v_position.average_price_paise;
  v_variation_numeric:=v_position.net_quantity::numeric
    *(p_settlement_price_paise::numeric-v_prior_basis::numeric);
  if v_variation_numeric>9223372036854775807
     or v_variation_numeric< -9223372036854775808 then
    raise exception 'Futures daily MTM exceeds bigint accounting range.' using errcode='22003';
  end if;
  v_variation:=v_variation_numeric::bigint;
  v_version:=coalesce(v_state.settlement_version,0)+1;

  update public.paper_accounts set
    cash_paise=cash_paise+v_variation,
    realized_pnl_paise=realized_pnl_paise+v_variation,
    version=version+1,updated_at=now()
   where user_id=p_user_id;
  update public.paper_futures_positions set
    average_price_paise=p_settlement_price_paise,
    realized_pnl_paise=realized_pnl_paise+v_variation,updated_at=now()
   where user_id=p_user_id and instrument_key=p_instrument_key;

  insert into public.paper_futures_settlement_state(
    user_id,instrument_key,last_settlement_date,last_settlement_price_paise,
    last_settlement_quantity,settlement_version,last_event_key,updated_at
  ) values (
    p_user_id,p_instrument_key,p_settlement_date,p_settlement_price_paise,
    v_position.net_quantity,v_version,p_event_key,now()
  ) on conflict(user_id,instrument_key) do update set
    last_settlement_date=excluded.last_settlement_date,
    last_settlement_price_paise=excluded.last_settlement_price_paise,
    last_settlement_quantity=excluded.last_settlement_quantity,
    settlement_version=excluded.settlement_version,
    last_event_key=excluded.last_event_key,updated_at=now();

  insert into public.paper_futures_risk_events(
    user_id,event_key,payload_sha256,event_type,instrument_key,contract_expiry,
    signed_quantity,price_paise,prior_basis_price_paise,cash_delta_paise,
    margin_delta_paise,realized_pnl_delta_paise,charges_paise,source_type,
    source_reference,source_sha256,source_timestamp_ms
  ) values (
    p_user_id,p_event_key,p_payload_sha256,'DAILY_MTM',p_instrument_key,v_position.expiry,
    v_position.net_quantity,p_settlement_price_paise,v_prior_basis,v_variation,
    0,v_variation,0,'NSE_OFFICIAL_DAILY_SETTLEMENT',p_source_reference,
    p_source_sha256,p_source_timestamp_ms
  ) returning event_id into v_event_id;

  update public.paper_futures_risk_state set
    risk_status=case
      when (select cash_paise-reserved_cash_paise-reserved_margin_paise
              from public.paper_accounts where user_id=p_user_id)<0 then 'MARGIN_CALL'
      else risk_status end,
    updated_at=now()
   where user_id=p_user_id and instrument_key=p_instrument_key;

  return jsonb_build_object('event_id',v_event_id,'event_type','DAILY_MTM',
    'quantity',v_position.net_quantity,'prior_basis_price_paise',v_prior_basis,
    'settlement_price_paise',p_settlement_price_paise,'cash_delta_paise',v_variation,
    'cash_paise',v_account.cash_paise+v_variation,
    'margin_deficit_paise',greatest(0::bigint,
      v_account.reserved_cash_paise+v_account.reserved_margin_paise-(v_account.cash_paise+v_variation)),
    'settlement_version',v_version,'idempotent_replay',false,'simulation_only',true);
end;
$$;

-- Store a fresh provider-supplied initial and maintenance margin snapshot.
-- The database never invents a maintenance percentage; NULL is rejected.
create or replace function public.refresh_paper_futures_margin(
  p_user_id uuid,
  p_instrument_key text,
  p_initial_margin_paise bigint,
  p_maintenance_margin_paise bigint,
  p_provider text,
  p_source_reference text,
  p_source_sha256 text,
  p_source_timestamp_ms bigint,
  p_event_key text,
  p_payload_sha256 text,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_existing public.paper_futures_risk_events%rowtype;
  v_now_ms bigint;
  v_margin_delta bigint;
  v_new_account_margin bigint;
  v_status text;
  v_event_id uuid;
begin
  if p_user_id is null or p_instrument_key is null
     or length(p_instrument_key) not between 1 and 100
     or p_initial_margin_paise is null or p_initial_margin_paise<=0
     or p_maintenance_margin_paise is null or p_maintenance_margin_paise<=0
     or p_provider is null or p_provider not in ('UPSTOX','ZERODHA','ANGEL_ONE','DHAN','FYERS','AUTHORIZED_VENDOR')
     or p_source_reference is null or length(p_source_reference) not between 1 and 500
     or p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_timestamp_ms is null or p_source_timestamp_ms<=0
     or p_event_key is null or length(p_event_key) not between 1 and 200
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_now_ms is null or p_now_ms<=0 then
    raise exception 'Verified initial and maintenance margin values are required.' using errcode='22023';
  end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_now_ms-p_now_ms)>2000 or p_source_timestamp_ms>v_now_ms+2000
     or v_now_ms-p_source_timestamp_ms>900000 then
    raise exception 'Provider Futures margin snapshot is stale.' using errcode='22023';
  end if;
  if lower(p_source_reference) !~ '^https://([a-z0-9-]+[.])*(upstox[.]com|zerodha[.]com|angelone[.]in|dhan[.]co|fyers[.]in)(/|$)'
     and p_provider<>'AUTHORIZED_VENDOR' then
    raise exception 'Margin source does not match the named provider.' using errcode='22023';
  end if;
  if lower(p_source_reference) !~ '^https://' then
    raise exception 'Authorized vendor margin source must use HTTPS.' using errcode='22023';
  end if;

  select * into v_account from public.paper_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Paper Trading account is not initialized.' using errcode='P0002'; end if;
  select * into v_existing from public.paper_futures_risk_events
   where user_id=p_user_id and event_key=p_event_key;
  if found then
    if v_existing.payload_sha256<>p_payload_sha256 then
      raise exception 'Futures margin event key was reused with a different payload.' using errcode='23505';
    end if;
    return jsonb_build_object('event_id',v_existing.event_id,'idempotent_replay',true,'simulation_only',true);
  end if;
  select * into v_position from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  if not found then raise exception 'Open Futures position was not found.' using errcode='P0002'; end if;

  v_margin_delta:=p_initial_margin_paise-v_position.reserved_margin_paise;
  v_new_account_margin:=v_account.reserved_margin_paise+v_margin_delta;
  if v_new_account_margin<0 then
    raise exception 'Futures margin refresh would over-release account margin.' using errcode='23514';
  end if;
  v_status:=case
    when p_initial_margin_paise<p_maintenance_margin_paise then 'MARGIN_CALL'
    when v_account.cash_paise-v_account.reserved_cash_paise-v_new_account_margin<0 then 'MARGIN_CALL'
    else 'HEALTHY'
  end;

  update public.paper_futures_positions set reserved_margin_paise=p_initial_margin_paise,updated_at=now()
   where user_id=p_user_id and instrument_key=p_instrument_key;
  update public.paper_accounts set reserved_margin_paise=v_new_account_margin,
    version=version+1,updated_at=now() where user_id=p_user_id;

  insert into public.paper_futures_risk_state(
    user_id,instrument_key,initial_margin_paise,maintenance_margin_paise,
    risk_status,provider,source_reference,source_sha256,source_timestamp_ms,snapshot_version,updated_at
  ) values (
    p_user_id,p_instrument_key,p_initial_margin_paise,p_maintenance_margin_paise,
    v_status,p_provider,p_source_reference,p_source_sha256,p_source_timestamp_ms,1,now()
  ) on conflict(user_id,instrument_key) do update set
    initial_margin_paise=excluded.initial_margin_paise,
    maintenance_margin_paise=excluded.maintenance_margin_paise,
    risk_status=excluded.risk_status,provider=excluded.provider,
    source_reference=excluded.source_reference,source_sha256=excluded.source_sha256,
    source_timestamp_ms=excluded.source_timestamp_ms,
    snapshot_version=public.paper_futures_risk_state.snapshot_version+1,updated_at=now();

  insert into public.paper_futures_risk_events(
    user_id,event_key,payload_sha256,event_type,instrument_key,contract_expiry,
    signed_quantity,price_paise,prior_basis_price_paise,cash_delta_paise,
    margin_delta_paise,realized_pnl_delta_paise,charges_paise,source_type,
    source_reference,source_sha256,source_timestamp_ms
  ) values (
    p_user_id,p_event_key,p_payload_sha256,'MARGIN_REFRESH',p_instrument_key,v_position.expiry,
    v_position.net_quantity,v_position.average_price_paise,null,0,v_margin_delta,0,0,
    p_provider||'_MARGIN',p_source_reference,p_source_sha256,p_source_timestamp_ms
  ) returning event_id into v_event_id;

  return jsonb_build_object('event_id',v_event_id,'initial_margin_paise',p_initial_margin_paise,
    'maintenance_margin_paise',p_maintenance_margin_paise,'margin_delta_paise',v_margin_delta,
    'risk_status',v_status,'margin_deficit_paise',greatest(0::bigint,
      v_account.reserved_cash_paise+v_new_account_margin-v_account.cash_paise),
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

-- Explicit final settlement or paper-only square-off. All pending Futures LIMIT
-- orders are terminalized and their unfilled opening/closing reservations released
-- in the same account -> order -> position transaction.
create or replace function public.close_paper_futures_position(
  p_user_id uuid,
  p_instrument_key text,
  p_close_reason text,
  p_settlement_date date,
  p_close_price_paise bigint,
  p_charges_paise bigint,
  p_event_key text,
  p_payload_sha256 text,
  p_source_type text,
  p_source_reference text,
  p_source_sha256 text,
  p_source_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_existing public.paper_futures_risk_events%rowtype;
  v_order record;
  v_pending_open_margin bigint:=0;
  v_pending_close_quantity bigint:=0;
  v_margin_release bigint;
  v_realized_numeric numeric;
  v_realized bigint;
  v_cash_delta bigint;
  v_new_account_margin bigint;
  v_now_ms bigint;
  v_event_id uuid;
begin
  if p_user_id is null or p_instrument_key is null
     or length(p_instrument_key) not between 1 and 100
     or p_close_reason is null or p_close_reason not in ('EXPIRY_SETTLEMENT','SIMULATED_SQUARE_OFF')
     or p_settlement_date is null
     or p_close_price_paise is null or p_close_price_paise<=0
     or p_charges_paise is null or p_charges_paise<0
     or p_event_key is null or length(p_event_key) not between 1 and 200
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_type is null or length(p_source_type) not between 1 and 40
     or p_source_reference is null or length(p_source_reference) not between 1 and 500
     or p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_timestamp_ms is null or p_source_timestamp_ms<=0
     or p_now_ms is null or p_now_ms<=0 then
    raise exception 'Invalid Futures close/settlement input.' using errcode='22023';
  end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_now_ms-p_now_ms)>2000 or p_source_timestamp_ms>v_now_ms+2000
     or v_now_ms-p_source_timestamp_ms>900000
     or p_settlement_date>(clock_timestamp() at time zone 'Asia/Kolkata')::date then
    raise exception 'Futures close source/date is stale or in the future.' using errcode='22023';
  end if;

  if p_close_reason='EXPIRY_SETTLEMENT' then
    if p_source_type<>'NSE_OFFICIAL_FINAL_SETTLEMENT'
       or lower(p_source_reference) !~ '^https://([a-z0-9-]+[.])*(nseindia[.]com|nsearchives[.]nseindia[.]com)(/|$)' then
      raise exception 'Expiry settlement requires official NSE final-settlement provenance.' using errcode='22023';
    end if;
  else
    if p_source_type not in ('UPSTOX_QUOTE','ZERODHA_QUOTE','ANGEL_ONE_QUOTE','DHAN_QUOTE','FYERS_QUOTE','AUTHORIZED_VENDOR_QUOTE')
       or lower(p_source_reference) !~ '^https://' then
      raise exception 'Square-off requires a fresh authorized HTTPS provider quote.' using errcode='22023';
    end if;
  end if;

  select * into v_account from public.paper_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Paper Trading account is not initialized.' using errcode='P0002'; end if;
  select * into v_existing from public.paper_futures_risk_events
   where user_id=p_user_id and event_key=p_event_key;
  if found then
    if v_existing.payload_sha256<>p_payload_sha256 then
      raise exception 'Futures close event key was reused with a different payload.' using errcode='23505';
    end if;
    return jsonb_build_object('event_id',v_existing.event_id,'event_type',v_existing.event_type,
      'cash_delta_paise',v_existing.cash_delta_paise,'idempotent_replay',true,'simulation_only',true);
  end if;

  for v_order in
    select order_id,reserved_open_margin_paise,reserved_close_quantity
      from public.paper_futures_orders
     where user_id=p_user_id and instrument_key=p_instrument_key
       and order_type='LIMIT' and status in ('PENDING','PARTIALLY_FILLED')
     order by created_at,order_id for update
  loop
    v_pending_open_margin:=v_pending_open_margin+v_order.reserved_open_margin_paise;
    v_pending_close_quantity:=v_pending_close_quantity+v_order.reserved_close_quantity;
    update public.paper_futures_orders set
      status='EXPIRED',reserved_open_margin_paise=0,reserved_close_quantity=0,
      reservation_released=true,updated_at=now()
     where order_id=v_order.order_id;
  end loop;

  select * into v_position from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  if not found then raise exception 'Open Futures position was not found.' using errcode='P0002'; end if;
  if v_pending_close_quantity<>v_position.reserved_close_quantity then
    raise exception 'Pending close reservations do not reconcile with the Futures position.' using errcode='23514';
  end if;
  if p_close_price_paise%v_position.tick_size_paise<>0 then
    raise exception 'Futures close price is off contract tick size.' using errcode='22023';
  end if;

  if p_close_reason='EXPIRY_SETTLEMENT' then
    if v_position.exchange<>'NSE' or p_settlement_date<v_position.expiry then
      raise exception 'NSE expiry settlement cannot precede contract expiry or use a non-NSE contract.' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.paper_exchange_sessions s
       where s.exchange='NSE' and s.session_date=p_settlement_date
         and s.is_trading_day is true and s.session_kind in ('REGULAR','SPECIAL')
         and s.verified_at<=clock_timestamp()
         and s.source_sha256 ~ '^[a-f0-9]{64}$'
         and lower(s.source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)'
    ) then
      raise exception 'A verified NSE session is required for final settlement.' using errcode='22023';
    end if;
  elsif p_settlement_date>=v_position.expiry then
    raise exception 'Expired Futures contracts require official final settlement.' using errcode='22023';
  end if;

  v_margin_release:=v_position.reserved_margin_paise+v_pending_open_margin;
  if v_account.reserved_margin_paise<v_margin_release then
    raise exception 'Futures account margin reservation is inconsistent.' using errcode='23514';
  end if;
  v_new_account_margin:=v_account.reserved_margin_paise-v_margin_release;
  v_realized_numeric:=v_position.net_quantity::numeric
    *(p_close_price_paise::numeric-v_position.average_price_paise::numeric);
  if v_realized_numeric>9223372036854775807
     or v_realized_numeric< -9223372036854775808 then
    raise exception 'Futures close P&L exceeds bigint range.' using errcode='22003';
  end if;
  v_realized:=v_realized_numeric::bigint;
  v_cash_delta:=v_realized-p_charges_paise;

  update public.paper_futures_positions set reserved_close_quantity=0
   where user_id=p_user_id and instrument_key=p_instrument_key;
  update public.paper_accounts set
    cash_paise=cash_paise+v_cash_delta,
    reserved_margin_paise=v_new_account_margin,
    realized_pnl_paise=realized_pnl_paise+v_realized,
    version=version+1,updated_at=now()
   where user_id=p_user_id;
  delete from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key;
  update public.paper_futures_risk_state set risk_status='CLOSED',updated_at=now()
   where user_id=p_user_id and instrument_key=p_instrument_key;

  insert into public.paper_futures_risk_events(
    user_id,event_key,payload_sha256,event_type,instrument_key,contract_expiry,
    signed_quantity,price_paise,prior_basis_price_paise,cash_delta_paise,
    margin_delta_paise,realized_pnl_delta_paise,charges_paise,source_type,
    source_reference,source_sha256,source_timestamp_ms
  ) values (
    p_user_id,p_event_key,p_payload_sha256,p_close_reason,p_instrument_key,v_position.expiry,
    v_position.net_quantity,p_close_price_paise,v_position.average_price_paise,
    v_cash_delta,-v_margin_release,v_realized,p_charges_paise,p_source_type,
    p_source_reference,p_source_sha256,p_source_timestamp_ms
  ) returning event_id into v_event_id;

  return jsonb_build_object('event_id',v_event_id,'event_type',p_close_reason,
    'realized_pnl_paise',v_realized,'charges_paise',p_charges_paise,
    'cash_delta_paise',v_cash_delta,'released_margin_paise',v_margin_release,
    'released_pending_order_margin_paise',v_pending_open_margin,
    'released_close_quantity',v_pending_close_quantity,
    'cash_paise',v_account.cash_paise+v_cash_delta,
    'reserved_margin_paise',v_new_account_margin,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

-- If the current provider maintenance snapshot is UNKNOWN, stale, or in
-- MARGIN_CALL, risk-increasing orders/fills are rejected; reducing exits pass.
create or replace function public._guard_paper_futures_risk_increase()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_instrument_key text;
  v_side text;
  v_position public.paper_futures_positions%rowtype;
  v_risk public.paper_futures_risk_state%rowtype;
  v_now_ms bigint;
begin
  if tg_table_name='paper_futures_orders' then
    v_user_id:=new.user_id;
    v_instrument_key:=new.instrument_key;
    v_side:=new.side;
  else
    select user_id,instrument_key,side into v_user_id,v_instrument_key,v_side
      from public.paper_futures_orders where order_id=new.order_id;
    if not found then raise exception 'Futures fill has no owning order.' using errcode='23503'; end if;
  end if;

  select * into v_risk from public.paper_futures_risk_state
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found or v_risk.risk_status='CLOSED' then return new; end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if v_risk.risk_status='HEALTHY' and v_risk.source_timestamp_ms is not null
     and v_now_ms-v_risk.source_timestamp_ms<=900000 then
    return new;
  end if;

  select * into v_position from public.paper_futures_positions
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found then
    if tg_table_name='paper_futures_orders' and new.order_type='MARKET' then return new; end if;
    if tg_table_name='paper_futures_fills' then return new; end if;
    raise exception 'Futures margin snapshot is UNKNOWN, stale or in margin call; opening exposure is blocked.'
      using errcode='55000';
  end if;

  if (v_position.net_quantity>0 and v_side='SELL')
     or (v_position.net_quantity<0 and v_side='BUY') then
    return new;
  end if;
  raise exception 'Futures margin snapshot is UNKNOWN, stale or in margin call; risk-increasing exposure is blocked.'
    using errcode='55000';
end;
$$;

-- Seed UNKNOWN after a first position is created. A fresh provider snapshot is
-- required before increasing it; a flattened position becomes CLOSED.
create or replace function public._seed_paper_futures_unknown_risk_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_instrument_key text;
  v_position public.paper_futures_positions%rowtype;
begin
  if tg_table_name='paper_futures_orders' then
    v_user_id:=new.user_id;
    v_instrument_key:=new.instrument_key;
    select * into v_position from public.paper_futures_positions
     where user_id=v_user_id and instrument_key=v_instrument_key;
    if not found and new.order_type='LIMIT' then return new; end if;
    if not found and new.order_type='MARKET' then
      insert into public.paper_futures_risk_state(
        user_id,instrument_key,initial_margin_paise,maintenance_margin_paise,
        risk_status,snapshot_version,updated_at
      ) values (v_user_id,v_instrument_key,0,null,'CLOSED',1,now())
      on conflict(user_id,instrument_key) do update set
        initial_margin_paise=0,maintenance_margin_paise=null,risk_status='CLOSED',
        provider=null,source_reference=null,source_sha256=null,source_timestamp_ms=null,
        snapshot_version=public.paper_futures_risk_state.snapshot_version+1,updated_at=now();
      return new;
    end if;
  else
    select user_id,instrument_key into v_user_id,v_instrument_key
      from public.paper_futures_orders where order_id=new.order_id;
    if not found then return new; end if;
    select * into v_position from public.paper_futures_positions
     where user_id=v_user_id and instrument_key=v_instrument_key;
    if not found then
      update public.paper_futures_risk_state set risk_status='CLOSED',updated_at=now()
       where user_id=v_user_id and instrument_key=v_instrument_key;
      return new;
    end if;
  end if;

  insert into public.paper_futures_risk_state(
    user_id,instrument_key,initial_margin_paise,maintenance_margin_paise,
    risk_status,snapshot_version,updated_at
  ) values (
    v_user_id,v_instrument_key,v_position.reserved_margin_paise,null,'UNKNOWN',1,now()
  ) on conflict(user_id,instrument_key) do update set
    initial_margin_paise=excluded.initial_margin_paise,
    maintenance_margin_paise=null,risk_status='UNKNOWN',
    provider=null,source_reference=null,source_sha256=null,source_timestamp_ms=null,
    snapshot_version=public.paper_futures_risk_state.snapshot_version+1,updated_at=now();
  return new;
end;
$$;

drop trigger if exists paper_futures_risk_guard_order on public.paper_futures_orders;
create trigger paper_futures_risk_guard_order
before insert on public.paper_futures_orders
for each row execute function public._guard_paper_futures_risk_increase();
drop trigger if exists paper_futures_risk_guard_fill on public.paper_futures_fills;
create trigger paper_futures_risk_guard_fill
before insert on public.paper_futures_fills
for each row execute function public._guard_paper_futures_risk_increase();

drop trigger if exists paper_futures_seed_unknown_risk_order on public.paper_futures_orders;
create trigger paper_futures_seed_unknown_risk_order
after insert on public.paper_futures_orders
for each row execute function public._seed_paper_futures_unknown_risk_state();
drop trigger if exists paper_futures_seed_unknown_risk_fill on public.paper_futures_fills;
create trigger paper_futures_seed_unknown_risk_fill
after insert on public.paper_futures_fills
for each row execute function public._seed_paper_futures_unknown_risk_state();

revoke all on function public.post_paper_futures_daily_mtm(uuid,text,date,bigint,text,text,text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public.refresh_paper_futures_margin(uuid,text,bigint,bigint,text,text,text,bigint,text,text,bigint) from public,anon,authenticated;
revoke all on function public.close_paper_futures_position(uuid,text,text,date,bigint,bigint,text,text,text,text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public._guard_paper_futures_risk_increase() from public,anon,authenticated;
revoke all on function public._seed_paper_futures_unknown_risk_state() from public,anon,authenticated;
grant execute on function public.post_paper_futures_daily_mtm(uuid,text,date,bigint,text,text,text,text,bigint,bigint) to service_role;
grant execute on function public.refresh_paper_futures_margin(uuid,text,bigint,bigint,text,text,text,bigint,text,text,bigint) to service_role;
grant execute on function public.close_paper_futures_position(uuid,text,text,date,bigint,bigint,text,text,text,text,text,bigint,bigint) to service_role;

comment on table public.paper_futures_risk_events is
  'Append-only Futures paper-accounting events. Corrections must use compensating events.';
comment on column public.paper_accounts.margin_deficit_paise is
  'Generated shortfall between virtual cash and reserved funds after Futures MTM losses.';
