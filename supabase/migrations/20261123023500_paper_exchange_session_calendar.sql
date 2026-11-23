-- DRAFT ONLY — trusted NSE/BSE session calendar foundation for Indian-market Intraday LIMIT.
-- No weekday-based trading-day inference: missing or unverified calendar rows fail closed.
-- Populate only from verified exchange notices; special sessions require explicit minutes.
create table if not exists public.paper_exchange_sessions (
  exchange text not null check (exchange in ('NSE','BSE')),
  session_date date not null,
  is_trading_day boolean not null,
  open_minute integer,
  close_minute integer,
  session_kind text not null default 'REGULAR'
    check (session_kind in ('REGULAR','SPECIAL','CLOSED')),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 500),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exchange, session_date),
  constraint paper_exchange_session_window_valid check (
    (is_trading_day is true
      and session_kind in ('REGULAR','SPECIAL')
      and open_minute is not null
      and close_minute is not null
      and open_minute between 0 and 1439
      and close_minute between 1 and 1440
      and open_minute < close_minute)
    or
    (is_trading_day is false
      and session_kind = 'CLOSED'
      and open_minute is null
      and close_minute is null)
  )
);

create index if not exists paper_exchange_sessions_verified_date_idx
  on public.paper_exchange_sessions (session_date, exchange)
  where verified_at is not null;

alter table public.paper_exchange_sessions enable row level security;
revoke all on table public.paper_exchange_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.paper_exchange_sessions to service_role;

comment on table public.paper_exchange_sessions is
  'Trusted, explicitly verified NSE/BSE trading sessions. No row or unverified calendar data means closed/fail-closed.';
comment on column public.paper_exchange_sessions.source_reference is
  'Exchange circular or official notice reference supporting this exact session.';
comment on column public.paper_exchange_sessions.verified_at is
  'Timestamp when the source and session window were checked by an authorized operator.';
