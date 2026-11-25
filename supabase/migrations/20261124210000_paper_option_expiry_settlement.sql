-- DRAFT ONLY. Atomic expiry settlement for verified cash-settled NSE index options.
-- Stock/physical-settled and unknown settlement contracts are deliberately rejected.
-- STT on exercised options is 0.15% of intrinsic value from 2026-04-01.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.paper_option_expiry_settlements (
  settlement_id text primary key check (settlement_id ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  instrument_key text not null check (length(instrument_key) between 1 and 160),
  trading_symbol text not null check (length(trading_symbol) between 1 and 80),
  exchange text not null check (exchange='NSE'),
  segment text not null check (segment='NSE_FO'),
  instrument_type text not null check (instrument_type in ('CE','PE')),
  underlying_type text not null check (underlying_type='INDEX'),
  settlement_type text not null check (settlement_type='CASH_SETTLED'),
  expiry date not null,
  strike_price_paise bigint not null check (strike_price_paise>0),
  settlement_price_paise bigint not null check (settlement_price_paise>=0),
  settled_quantity integer not null check (settled_quantity>0),
  entry_cost_basis_paise bigint not null check (entry_cost_basis_paise>0),
  intrinsic_value_paise bigint not null check (intrinsic_value_paise>=0),
  gross_payout_paise bigint not null check (gross_payout_paise>=0),
  exercise_stt_paise bigint not null check (exercise_stt_paise>=0),
  net_payout_paise bigint not null check (net_payout_paise>=0),
  realized_pnl_paise bigint not null,
  settlement_source text not null check (settlement_source ~* '^https://([a-z0-9-]+[.])*nseindia[.]com/'),
  settlement_source_sha256 text not null check (settlement_source_sha256 ~ '^[a-f0-9]{64}$'),
  settlement_timestamp_ms bigint not null check (settlement_timestamp_ms>0),
  verified_at_ms bigint not null check (verified_at_ms>0),
  charge_schedule_version text not null check (charge_schedule_version='NSE_EXERCISE_STT_2026_04_V1'),
  simulation_only boolean not null default true check (simulation_only is true),
  created_at timestamptz not null default now(),
  constraint paper_option_expiry_payout_conservation
    check (net_payout_paise=gross_payout_paise-exercise_stt_paise),
  constraint paper_option_expiry_realized_conservation
    check (realized_pnl_paise=net_payout_paise-entry_cost_basis_paise),
  unique(user_id,instrument_key,expiry)
);

alter table public.paper_option_expiry_settlements enable row level security;
drop policy if exists paper_option_expiry_settlements_select_own
  on public.paper_option_expiry_settlements;
create policy paper_option_expiry_settlements_select_own
  on public.paper_option_expiry_settlements for select to authenticated
  using (user_id=auth.uid());
revoke all on public.paper_option_expiry_settlements from public,anon,authenticated;
grant select on public.paper_option_expiry_settlements to authenticated;
grant select,insert on public.paper_option_expiry_settlements to service_role;

create or replace function public._reject_paper_option_expiry_settlement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Paper Options expiry settlements are append-only.'
    using errcode='55000';
end;
$$;

drop trigger if exists paper_option_expiry_settlement_immutable
  on public.paper_option_expiry_settlements;
create trigger paper_option_expiry_settlement_immutable
before update or delete on public.paper_option_expiry_settlements
for each row execute function public._reject_paper_option_expiry_settlement_mutation();
revoke all on function public._reject_paper_option_expiry_settlement_mutation()
  from public,anon,authenticated,service_role;

create or replace function public.settle_paper_long_index_option_expiry(
  p_user_id uuid,
  p_settlement_id text,
  p_instrument_key text,
  p_trading_symbol text,
  p_instrument_type text,
  p_underlying_type text,
  p_settlement_type text,
  p_expiry date,
  p_strike_price_paise bigint,
  p_settlement_price_paise bigint,
  p_settlement_source text,
  p_settlement_source_content text,
  p_settlement_source_sha256 text,
  p_settlement_timestamp_ms bigint,
  p_verified_at_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_derivative_positions%rowtype;
  v_existing public.paper_option_expiry_settlements%rowtype;
  v_now timestamptz;
  v_now_ms bigint;
  v_source_date date;
  v_intrinsic bigint;
  v_payout_numeric numeric;
  v_payout bigint;
  v_stt_numeric numeric;
  v_stt bigint;
  v_net bigint;
  v_realized bigint;
  v_cash bigint;
  v_cash_numeric numeric;
  v_account_realized bigint;
  v_account_realized_numeric numeric;
begin
  if p_user_id is null
     or p_settlement_id is null or p_settlement_id !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 160
     or p_trading_symbol is null or length(p_trading_symbol) not between 1 and 80
     or p_instrument_type is null or p_instrument_type not in ('CE','PE')
     or p_underlying_type is distinct from 'INDEX'
     or p_settlement_type is distinct from 'CASH_SETTLED'
     or p_expiry is null
     or p_strike_price_paise is null or p_strike_price_paise<=0 or p_strike_price_paise>9007199254740991
     or p_settlement_price_paise is null or p_settlement_price_paise<0 or p_settlement_price_paise>9007199254740991
     or p_settlement_source is null
     or lower(p_settlement_source) !~ '^https://([a-z0-9-]+[.])*nseindia[.]com/'
     or p_settlement_source_content is null
     or length(p_settlement_source_content) not between 1 and 2000000
     or p_settlement_source_sha256 is null
     or p_settlement_source_sha256 !~ '^[a-f0-9]{64}$'
     or encode(extensions.digest(convert_to(p_settlement_source_content,'UTF8'),'sha256'),'hex')
          <>p_settlement_source_sha256
     or p_settlement_timestamp_ms is null or p_settlement_timestamp_ms<=0
     or p_verified_at_ms is null or p_verified_at_ms<=0
     or p_now_ms is null or p_now_ms<=0 then
    raise exception 'Invalid or unverified NSE cash-settled index option expiry input.'
      using errcode='22023';
  end if;

  v_now:=clock_timestamp();
  v_now_ms:=floor(extract(epoch from v_now)*1000)::bigint;
  if abs(v_now_ms::numeric-p_now_ms::numeric)>2000
     or p_verified_at_ms>v_now_ms
     or p_settlement_timestamp_ms>p_verified_at_ms then
    raise exception 'Expiry settlement clock or verification timestamps are invalid.'
      using errcode='22023';
  end if;
  v_source_date:=(to_timestamp(p_settlement_timestamp_ms/1000.0)
    at time zone 'Asia/Kolkata')::date;
  if v_source_date<>p_expiry
     or p_expiry>(v_now at time zone 'Asia/Kolkata')::date
     or v_now<((p_expiry+time '15:30') at time zone 'Asia/Kolkata')
     or to_timestamp(p_settlement_timestamp_ms/1000.0)<((p_expiry+time '15:30') at time zone 'Asia/Kolkata') then
    raise exception 'Only a past, completed NSE contract expiry can be settled.'
      using errcode='22023';
  end if;

  -- Consistent global write order: account, then position, then append-only receipt.
  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;

  select * into v_existing from public.paper_option_expiry_settlements
   where user_id=p_user_id and instrument_key=p_instrument_key and expiry=p_expiry;
  if found then
    if v_existing.settlement_id<>p_settlement_id
       or v_existing.trading_symbol<>p_trading_symbol
       or v_existing.instrument_type<>p_instrument_type
       or v_existing.underlying_type<>p_underlying_type
       or v_existing.settlement_type<>p_settlement_type
       or v_existing.strike_price_paise<>p_strike_price_paise
       or v_existing.settlement_source<>p_settlement_source
       or v_existing.settlement_source_sha256<>p_settlement_source_sha256
       or v_existing.settlement_price_paise<>p_settlement_price_paise
       or v_existing.settlement_timestamp_ms<>p_settlement_timestamp_ms
       or v_existing.verified_at_ms<>p_verified_at_ms then
      raise exception 'Expiry settlement replay changed its immutable settlement identity.'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'settlement_id',v_existing.settlement_id,
      'gross_payout_paise',v_existing.gross_payout_paise,
      'exercise_stt_paise',v_existing.exercise_stt_paise,
      'net_payout_paise',v_existing.net_payout_paise,
      'realized_pnl_paise',v_existing.realized_pnl_paise,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  select * into v_position from public.paper_derivative_positions
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  if not found
     or v_position.exchange is distinct from 'NSE'
     or v_position.segment is distinct from 'NSE_FO'
     or v_position.instrument_type is distinct from p_instrument_type
     or v_position.expiry is distinct from p_expiry
     or v_position.trading_symbol is distinct from p_trading_symbol
     or v_position.net_quantity<=0
     or v_position.reserved_quantity<>0
     or v_position.cost_basis_paise<=0 or v_position.cost_basis_paise>9007199254740991 then
    raise exception 'Expiry position metadata or unreserved long quantity does not match.'
      using errcode='23514';
  end if;

  if exists(
    select 1 from public.paper_option_limit_orders
     where user_id=p_user_id and instrument_key=p_instrument_key
       and status in ('PENDING','PARTIALLY_FILLED')
  ) then
    raise exception 'Active Options LIMIT orders must be expired or cancelled before contract settlement.'
      using errcode='23514';
  end if;

  v_intrinsic:=case when p_instrument_type='CE'
    then greatest(p_settlement_price_paise-p_strike_price_paise,0)
    else greatest(p_strike_price_paise-p_settlement_price_paise,0) end;
  v_payout_numeric:=v_intrinsic::numeric*v_position.net_quantity::numeric;
  if v_payout_numeric>9007199254740991 then
    raise exception 'Options expiry payout exceeds supported safe integer limits.'
      using errcode='22003';
  end if;
  v_payout:=v_payout_numeric::bigint;

  -- Finance Act 2026: 0.15% STT on intrinsic value when an option is exercised.
  -- Store in paise, rounded to the nearest rupee as a rupee-denominated statutory levy.
  v_stt_numeric:=v_payout_numeric*0.0015;
  v_stt:=floor(v_stt_numeric/100+0.5)::bigint*100;
  v_net:=v_payout-v_stt;
  if v_net<0 then
    raise exception 'Expiry STT exceeds the gross intrinsic payout.' using errcode='23514';
  end if;
  v_realized:=v_net-v_position.cost_basis_paise;
  v_cash_numeric:=v_account.cash_paise::numeric+v_net::numeric;
  v_account_realized_numeric:=v_account.realized_pnl_paise::numeric+v_realized::numeric;
  if abs(v_cash_numeric)>9007199254740991
     or abs(v_account_realized_numeric)>9007199254740991 then
    raise exception 'Expiry settlement would exceed safe account cash or realized-P&L limits.'
      using errcode='23514';
  end if;
  v_cash:=v_cash_numeric::bigint;
  v_account_realized:=v_account_realized_numeric::bigint;
  if v_account.reserved_cash_paise::numeric+v_account.reserved_margin_paise::numeric>v_cash_numeric then
    raise exception 'Expiry settlement would violate account reservation invariants.' using errcode='23514';
  end if;

  insert into public.paper_option_expiry_settlements(
    settlement_id,user_id,instrument_key,trading_symbol,exchange,segment,
    instrument_type,underlying_type,settlement_type,expiry,strike_price_paise,
    settlement_price_paise,settled_quantity,entry_cost_basis_paise,
    intrinsic_value_paise,gross_payout_paise,exercise_stt_paise,net_payout_paise,
    realized_pnl_paise,settlement_source,settlement_source_sha256,
    settlement_timestamp_ms,verified_at_ms,charge_schedule_version,simulation_only
  ) values (
    p_settlement_id,p_user_id,p_instrument_key,p_trading_symbol,'NSE','NSE_FO',
    p_instrument_type,p_underlying_type,p_settlement_type,p_expiry,p_strike_price_paise,
    p_settlement_price_paise,v_position.net_quantity,v_position.cost_basis_paise,
    v_intrinsic,v_payout,v_stt,v_net,v_realized,p_settlement_source,
    p_settlement_source_sha256,p_settlement_timestamp_ms,p_verified_at_ms,
    'NSE_EXERCISE_STT_2026_04_V1',true
  );

  update public.paper_accounts
     set cash_paise=v_cash,realized_pnl_paise=v_account_realized,
         version=version+1,updated_at=now()
   where user_id=p_user_id;
  delete from public.paper_derivative_positions
   where user_id=p_user_id and instrument_key=p_instrument_key;

  return jsonb_build_object(
    'settlement_id',p_settlement_id,'gross_payout_paise',v_payout,
    'exercise_stt_paise',v_stt,'net_payout_paise',v_net,
    'realized_pnl_paise',v_realized,'idempotent_replay',false,
    'simulation_only',true
  );
end;
$$;

revoke all on function public.settle_paper_long_index_option_expiry(
  uuid,text,text,text,text,text,text,date,bigint,bigint,text,text,text,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.settle_paper_long_index_option_expiry(
  uuid,text,text,text,text,text,text,date,bigint,bigint,text,text,text,bigint,bigint,bigint
) to service_role;
