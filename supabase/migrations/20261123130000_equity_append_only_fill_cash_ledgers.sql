-- DRAFT ONLY — schema foundation; do not apply to production.
-- Append-only audit records for cash-equity fills and cash movements.
-- Existing MARKET/LIMIT RPCs are intentionally NOT rewired in this migration.
-- The follow-up transaction migration must insert both rows atomically with each fill.

create table if not exists public.paper_equity_fills (
  fill_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null references public.paper_orders(order_id) on delete restrict,
  execution_id text not null check (length(execution_id) between 1 and 128),
  instrument_key text not null check (length(instrument_key) between 1 and 100),
  exchange text not null check (exchange in ('NSE','BSE')),
  product text not null check (product in ('DELIVERY','INTRADAY')),
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity between 1 and 1000000),
  execution_price_paise bigint not null check (execution_price_paise > 0),
  gross_paise bigint not null check (gross_paise > 0),
  charges_paise bigint not null check (charges_paise >= 0),
  charges_breakdown jsonb not null check (jsonb_typeof(charges_breakdown)='object'),
  cash_delta_paise bigint not null,
  realized_pnl_paise bigint not null default 0,
  quote_timestamp_ms bigint not null check (quote_timestamp_ms > 0),
  filled_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint paper_equity_fills_order_execution_unique unique(order_id, execution_id)
);

create index if not exists paper_equity_fills_user_filled_idx
  on public.paper_equity_fills(user_id, filled_at desc, fill_id desc);
create index if not exists paper_equity_fills_instrument_idx
  on public.paper_equity_fills(user_id, product, instrument_key, filled_at desc);

create table if not exists public.paper_equity_cash_ledger (
  ledger_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text references public.paper_orders(order_id) on delete restrict,
  fill_id uuid references public.paper_equity_fills(fill_id) on delete restrict,
  event_key text not null check (length(event_key) between 1 and 160),
  event_type text not null check (event_type in (
    'TRADE_DEBIT','TRADE_CREDIT','RESERVATION_CREATE',
    'RESERVATION_RELEASE','RESERVATION_CONSUME','ADJUSTMENT'
  )),
  cash_delta_paise bigint not null default 0,
  reserved_cash_delta_paise bigint not null default 0,
  cash_balance_after_paise bigint not null check (cash_balance_after_paise >= 0),
  reserved_cash_after_paise bigint not null check (reserved_cash_after_paise >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default clock_timestamp(),
  constraint paper_equity_cash_ledger_user_event_unique unique(user_id,event_key),
  constraint paper_equity_cash_ledger_event_shape check (
    (event_type='TRADE_DEBIT' and cash_delta_paise<0 and fill_id is not null)
    or (event_type='TRADE_CREDIT' and cash_delta_paise>0 and fill_id is not null)
    or (event_type in ('RESERVATION_CREATE','RESERVATION_RELEASE','RESERVATION_CONSUME')
        and cash_delta_paise=0 and fill_id is null)
    or event_type='ADJUSTMENT'
  )
);

create index if not exists paper_equity_cash_ledger_user_created_idx
  on public.paper_equity_cash_ledger(user_id, created_at desc, ledger_id desc);
create index if not exists paper_equity_cash_ledger_order_idx
  on public.paper_equity_cash_ledger(order_id, created_at)
  where order_id is not null;

-- API users cannot read or mutate internal accounting records directly.
alter table public.paper_equity_fills enable row level security;
alter table public.paper_equity_cash_ledger enable row level security;
revoke all on public.paper_equity_fills, public.paper_equity_cash_ledger
  from public, anon, authenticated;
grant select, insert on public.paper_equity_fills, public.paper_equity_cash_ledger
  to service_role;

-- Defense in depth: even privileged application code cannot rewrite or erase
-- historical fills/ledger rows. Corrections must be compensating entries.
create or replace function public._paper_reject_equity_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception using errcode='55000',
    message='Equity fill and cash ledger records are append-only';
end;
$$;

drop trigger if exists paper_equity_fills_append_only on public.paper_equity_fills;
create trigger paper_equity_fills_append_only
  before update or delete on public.paper_equity_fills
  for each row execute function public._paper_reject_equity_audit_mutation();

drop trigger if exists paper_equity_cash_ledger_append_only on public.paper_equity_cash_ledger;
create trigger paper_equity_cash_ledger_append_only
  before update or delete on public.paper_equity_cash_ledger
  for each row execute function public._paper_reject_equity_audit_mutation();

revoke all on function public._paper_reject_equity_audit_mutation()
  from public, anon, authenticated, service_role;
