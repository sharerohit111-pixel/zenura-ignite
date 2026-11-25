-- Add provenance and a validated service-role import path for explicit NSE/BSE session calendars.
alter table public.paper_exchange_sessions
  add column if not exists source_sha256 text;
alter table public.paper_exchange_sessions
  add constraint paper_exchange_sessions_source_sha256_valid
  check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$');
comment on column public.paper_exchange_sessions.source_sha256 is
  'SHA-256 of the verified official exchange calendar CSV used to import this exact session row.';

revoke insert,update,delete on table public.paper_exchange_sessions from service_role;
grant select on table public.paper_exchange_sessions to service_role;

create or replace function public.import_paper_exchange_sessions(
  p_source_sha256 text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='Exchange session source SHA-256 is invalid';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='Exchange session rows must be a JSON array';
  end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>2000 then
    raise exception using errcode='22023',message='Exchange session row count is outside accepted limits';
  end if;
  select count(distinct x.exchange||'|'||x.session_date::text) into v_distinct
  from jsonb_to_recordset(p_rows) as x(
    exchange text,session_date date,is_trading_day boolean,open_minute integer,
    close_minute integer,session_kind text,source_reference text,verified_at timestamptz
  );
  if v_distinct<>v_count then
    raise exception using errcode='22023',message='Duplicate exchange/date session rows are not allowed';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_rows) as x(
      exchange text,session_date date,is_trading_day boolean,open_minute integer,
      close_minute integer,session_kind text,source_reference text,verified_at timestamptz
    )
    where x.exchange is null or x.exchange not in ('NSE','BSE')
       or x.session_date is null
       or x.session_date<((now() at time zone 'Asia/Kolkata')::date-7)
       or x.session_date>((now() at time zone 'Asia/Kolkata')::date+730)
       or x.is_trading_day is null
       or x.session_kind is null or x.session_kind not in ('REGULAR','SPECIAL','CLOSED')
       or x.source_reference is null or length(btrim(x.source_reference)) not between 1 and 500
       or x.verified_at is null or x.verified_at>now()
       or (x.exchange='NSE' and lower(x.source_reference) !~ '^https://([a-z0-9-]+\.)*nseindia\.com(/|$)')
       or (x.exchange='BSE' and lower(x.source_reference) !~ '^https://([a-z0-9-]+\.)*bseindia\.com(/|$)')
       or (x.is_trading_day is true and (
          x.session_kind not in ('REGULAR','SPECIAL')
          or x.open_minute is null or x.close_minute is null
          or x.open_minute not between 0 and 1439
          or x.close_minute not between 1 and 1440
          or x.open_minute>=x.close_minute
          or (x.session_kind='REGULAR' and (x.open_minute<>555 or x.close_minute<>930))
       ))
       or (x.is_trading_day is false and (
          x.session_kind<>'CLOSED' or x.open_minute is not null or x.close_minute is not null
       ))
  ) then
    raise exception using errcode='22023',message='Exchange session rows contain invalid date, window, source or verification metadata';
  end if;
  if exists(
    select 1
    from jsonb_to_recordset(p_rows) as x(
      exchange text,session_date date,is_trading_day boolean,open_minute integer,
      close_minute integer,session_kind text,source_reference text,verified_at timestamptz
    )
    join public.paper_exchange_sessions existing_session
      on existing_session.exchange=x.exchange and existing_session.session_date=x.session_date
    where existing_session.verified_at>x.verified_at
  ) then
    raise exception using errcode='22023',message='Older verified exchange session data cannot overwrite a newer revision';
  end if;
  -- Each imported exchange is a complete verified snapshot. Invalidate omitted dates
  -- so partial files cannot silently reuse an older open-session decision.
  update public.paper_exchange_sessions existing_session
     set source_sha256=null,updated_at=now()
   where existing_session.exchange in (
     select distinct x.exchange
     from jsonb_to_recordset(p_rows) as x(
       exchange text,session_date date,is_trading_day boolean,open_minute integer,
       close_minute integer,session_kind text,source_reference text,verified_at timestamptz
     )
   );
  insert into public.paper_exchange_sessions(
    exchange,session_date,is_trading_day,open_minute,close_minute,session_kind,
    source_reference,verified_at,source_sha256,updated_at
  )
  select x.exchange,x.session_date,x.is_trading_day,x.open_minute,x.close_minute,
    x.session_kind,x.source_reference,x.verified_at,p_source_sha256,now()
  from jsonb_to_recordset(p_rows) as x(
    exchange text,session_date date,is_trading_day boolean,open_minute integer,
    close_minute integer,session_kind text,source_reference text,verified_at timestamptz
  )
  on conflict(exchange,session_date) do update set
    is_trading_day=excluded.is_trading_day,
    open_minute=excluded.open_minute,
    close_minute=excluded.close_minute,
    session_kind=excluded.session_kind,
    source_reference=excluded.source_reference,
    verified_at=excluded.verified_at,
    source_sha256=excluded.source_sha256,
    updated_at=now();
  return jsonb_build_object('rows_imported',v_count,'source_sha256',p_source_sha256,'status','IMPORTED');
end;
$$;
revoke all on function public.import_paper_exchange_sessions(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_paper_exchange_sessions(text,jsonb) to service_role;
