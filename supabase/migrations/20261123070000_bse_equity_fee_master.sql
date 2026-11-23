-- BSE daily scrip-group fee master. Import is service-role only; end users cannot write fee metadata.
create table if not exists public.bse_equity_fee_master (
  source_date date not null,
  isin text not null check (isin ~ '^[A-Z]{2}[A-Z0-9]{10}$'),
  scrip_code text not null check (scrip_code ~ '^[0-9]{1,12}$'),
  instrument_code text not null check (length(instrument_code) between 1 and 12),
  scrip_name text not null,
  group_name text not null check (length(group_name) between 1 and 3 and group_name=upper(group_name)),
  exclusive_flag char(1) not null check (exclusive_flag in ('Y','N')),
  instrument_status char(1) not null check (instrument_status in ('A','S','I')),
  instrument_type char(1) not null check (instrument_type in ('E','D','C')),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_reference text not null check (lower(source_reference) ~ '^https://([a-z0-9-]+\.)*bseindia\.com(/|$)'),
  imported_at timestamptz not null default now(),
  primary key(source_date,isin),
  check (isin=upper(isin)),
  check (instrument_code=upper(instrument_code))
);
create index if not exists bse_equity_fee_master_isin_date_idx
  on public.bse_equity_fee_master(isin,source_date desc);
alter table public.bse_equity_fee_master enable row level security;
revoke all on public.bse_equity_fee_master from public,anon,authenticated,service_role;

create or replace function public.import_bse_equity_fee_master(
  p_source_date date,p_source_sha256 text,p_source_reference text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_count integer;
  v_distinct integer;
  v_existing_hash text;
  v_latest_date date;
begin
  if p_source_date is null or p_source_date>(now() at time zone 'Asia/Kolkata')::date
     or p_source_date<((now() at time zone 'Asia/Kolkata')::date-7) then
    raise exception using errcode='22023',message='BSE master source date is outside the accepted freshness window';
  end if;
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_reference is null
     or lower(p_source_reference) !~ '^https://([a-z0-9-]+\.)*bseindia\.com(/|$)' then
    raise exception using errcode='22023',message='BSE master provenance is invalid';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='BSE master rows must be a JSON array';
  end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>100000 then
    raise exception using errcode='22023',message='BSE master row count is outside the accepted limits';
  end if;
  select count(distinct x.isin) into v_distinct
  from jsonb_to_recordset(p_rows) as x(
    scrip_code text,instrument_code text,group_name text,scrip_name text,
    isin text,exclusive_flag text,status text,instrument_type text
  );
  if v_distinct<>v_count then
    raise exception using errcode='22023',message='BSE master contains duplicate ISIN rows';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_rows) as x(
      scrip_code text,instrument_code text,group_name text,scrip_name text,
      isin text,exclusive_flag text,status text,instrument_type text
    )
    where x.scrip_code is null or x.scrip_code !~ '^[0-9]{1,12}$'
       or x.instrument_code is null or length(x.instrument_code) not between 1 and 12
       or x.group_name is null or length(x.group_name) not between 1 and 3 or x.group_name<>upper(x.group_name)
       or x.scrip_name is null or x.isin is null or x.isin !~ '^[A-Z]{2}[A-Z0-9]{10}$'
       or x.instrument_code<>upper(x.instrument_code)
       or x.exclusive_flag is null or x.exclusive_flag not in ('Y','N')
       or x.status is null or x.status not in ('A','S','I')
       or x.instrument_type is null or x.instrument_type not in ('E','D','C')
  ) then
    raise exception using errcode='22023',message='BSE master contains invalid security metadata';
  end if;
  select max(source_date) into v_latest_date from public.bse_equity_fee_master;
  if v_latest_date is not null and p_source_date<v_latest_date then
    raise exception using errcode='22023',message='Older BSE master snapshots cannot replace newer data';
  end if;
  select max(source_sha256) into v_existing_hash
    from public.bse_equity_fee_master where source_date=p_source_date;
  if v_existing_hash is not null and v_existing_hash<>p_source_sha256 then
    raise exception using errcode='23505',message='A different BSE master file is already registered for this source date';
  end if;
  insert into public.bse_equity_fee_master(
    source_date,isin,scrip_code,instrument_code,group_name,scrip_name,
    exclusive_flag,instrument_status,instrument_type,source_sha256,source_reference
  )
  select p_source_date,x.isin,x.scrip_code,x.instrument_code,x.group_name,x.scrip_name,
    x.exclusive_flag,x.status,x.instrument_type,p_source_sha256,p_source_reference
  from jsonb_to_recordset(p_rows) as x(
    scrip_code text,instrument_code text,group_name text,scrip_name text,
    isin text,exclusive_flag text,status text,instrument_type text
  )
  on conflict(source_date,isin) do update set
    scrip_code=excluded.scrip_code,
    instrument_code=excluded.instrument_code,
    group_name=excluded.group_name,
    scrip_name=excluded.scrip_name,
    exclusive_flag=excluded.exclusive_flag,
    instrument_status=excluded.instrument_status,
    instrument_type=excluded.instrument_type,
    source_sha256=excluded.source_sha256,
    source_reference=excluded.source_reference,
    imported_at=now();
  return jsonb_build_object('source_date',p_source_date,'source_sha256',p_source_sha256,
    'rows_imported',v_count,'status','IMPORTED');
end;
$$;
revoke all on function public.import_bse_equity_fee_master(date,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.import_bse_equity_fee_master(date,text,text,jsonb) to service_role;

create or replace function public._paper_bse_cash_equity_charges(
  p_instrument_key text,p_gross_paise bigint,p_product text,p_side text
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_isin text;
  v_master public.bse_equity_fee_master%rowtype;
  v_today date;
  v_latest_source_date date;
  v_rate integer;
  v_brokerage bigint;
  v_exchange bigint;
  v_sebi bigint;
  v_stt bigint;
  v_stamp bigint;
  v_dp bigint;
  v_gst bigint;
  v_total bigint;
  v_net bigint;
begin
  v_today:=(now() at time zone 'Asia/Kolkata')::date;
  if p_instrument_key is null or p_instrument_key!~'^BSE_EQ\|[A-Z0-9]{12}$'
     or p_gross_paise is null or p_gross_paise<1 or p_gross_paise>9007199254740991
     or p_product is null or p_product not in ('DELIVERY','INTRADAY')
     or p_side is null or p_side not in ('BUY','SELL') then
    raise exception using errcode='22023',message='Invalid BSE cash-equity charge request';
  end if;
  v_isin:=split_part(p_instrument_key,'|',2);
  select max(source_date) into v_latest_source_date from public.bse_equity_fee_master
   where source_date<=v_today;
  if v_latest_source_date is null or v_latest_source_date<v_today-7 then
    raise exception using errcode='22023',message='Fresh BSE scrip-group master snapshot is unavailable';
  end if;
  select * into v_master from public.bse_equity_fee_master
   where isin=v_isin and source_date=v_latest_source_date;
  if not found then
    raise exception using errcode='22023',message='BSE instrument is absent from the latest official scrip master';
  end if;
  if v_master.instrument_status<>'A' or v_master.instrument_type<>'E' then
    raise exception using errcode='22023',message='BSE instrument is not an active equity scrip';
  end if;
  if v_master.group_name in ('P','ZP') then
    raise exception using errcode='22023',message='BSE P/ZP fee offset requires demat settlement classification and is not simulated';
  elsif v_master.group_name in ('A','B','NS','NT') then
    v_rate:=375;
  elsif v_master.group_name in ('E','F','FC','G','GC','I','W','T') then
    v_rate:=case when v_master.exclusive_flag='Y' then 275 else 375 end;
  elsif v_master.group_name in ('M','MT','TS','MS','IF','IT','R') then
    v_rate:=275;
  elsif v_master.group_name in ('X','XT','Z') then
    v_rate:=10000;
  else
    raise exception using errcode='22023',message='Unsupported BSE equity scrip group; fee settlement is disabled';
  end if;
  v_brokerage:=case when p_product='DELIVERY' then 2000::bigint
    else least(2000::bigint,round(p_gross_paise::numeric*0.001)::bigint) end;
  v_exchange:=round(p_gross_paise::numeric*v_rate*100/1000000000)::bigint;
  v_sebi:=round(p_gross_paise::numeric*0.000001)::bigint;
  v_stt:=case when p_product='DELIVERY' then round(p_gross_paise::numeric*0.001)::bigint
    when p_side='SELL' then round(p_gross_paise::numeric*0.00025)::bigint else 0 end;
  v_stamp:=case when p_side='BUY' and p_product='DELIVERY'
      then round(p_gross_paise::numeric*0.00015)::bigint
    when p_side='BUY' and p_product='INTRADAY'
      then round(p_gross_paise::numeric*0.00003)::bigint else 0 end;
  v_dp:=case when p_product='DELIVERY' and p_side='SELL' then 2000 else 0 end;
  v_gst:=round((v_brokerage+v_exchange+v_dp)::numeric*0.18)::bigint;
  v_total:=v_brokerage+v_exchange+v_sebi+v_stt+v_stamp+v_dp+v_gst;
  v_net:=p_gross_paise-v_total;
  if v_total<0 or v_total>9007199254740991 or p_gross_paise+v_total>9007199254740991
     or (p_side='SELL' and v_net<=0) then
    raise exception using errcode='22003',message='BSE equity charges exceed supported net settlement limits';
  end if;
  return jsonb_build_object(
    'schedule_version','BSE-2025-04-29','exchange','BSE','product',p_product,'side',p_side,
    'gross_paise',p_gross_paise,'brokerage_paise',v_brokerage,
    'exchange_transaction_paise',v_exchange,'exchange_rate_rupees_per_crore',v_rate,'exchange_rate_paise_per_crore',v_rate*100,
    'ipft_paise',0,'bse_ipf_included',true,'sebi_paise',v_sebi,'stt_paise',v_stt,
    'stamp_duty_paise',v_stamp,'dp_charges_paise',v_dp,'gst_paise',v_gst,
    'total_charges_paise',v_total,'total_debit_paise',case when p_side='BUY' then p_gross_paise+v_total else null end,
    'net_credit_paise',case when p_side='SELL' then v_net else null end,
    'scrip_group',v_master.group_name,'exclusive_flag',v_master.exclusive_flag,
    'scrip_code',v_master.scrip_code,'isin',v_master.isin,
    'master_source_date',v_master.source_date,'master_source_sha256',v_master.source_sha256,
    'master_source_reference',v_master.source_reference,
    'simulation_billing_basis','indicative_per_fill_allocation','indicative',true,'simulation_only',true
  );
end;
$$;
revoke all on function public._paper_bse_cash_equity_charges(text,bigint,text,text)
  from public,anon,authenticated,service_role;

create or replace function public._paper_cash_equity_charges(
  p_instrument_key text,p_exchange text,p_gross_paise bigint,p_product text,p_side text
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if p_exchange='NSE' then
    return public._paper_nse_cash_equity_charges(p_gross_paise,p_product,p_side);
  elsif p_exchange='BSE' then
    return public._paper_bse_cash_equity_charges(p_instrument_key,p_gross_paise,p_product,p_side);
  end if;
  raise exception using errcode='22023',message='Unsupported cash-equity exchange';
end;
$$;
revoke all on function public._paper_cash_equity_charges(text,text,bigint,text,text)
  from public,anon,authenticated,service_role;
