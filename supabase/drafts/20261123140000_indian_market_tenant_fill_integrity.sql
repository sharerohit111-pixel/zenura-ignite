-- DRAFT ONLY — do not place in supabase/migrations until the Equity,
-- Futures LIMIT, and Options LIMIT schema chains are integrated and rehearsed.
-- Tenant-safe relationships + immutable fill records. No Crypto objects referenced.
-- This migration intentionally fails if prerequisites are absent or historical
-- rows violate the new relationships; it never silently skips a subsystem.


alter table public.paper_orders
  add constraint paper_orders_user_order_key unique (user_id, order_id);
alter table public.paper_equity_fills
  add constraint paper_equity_fills_user_fill_key unique (user_id, fill_id);
alter table public.paper_futures_orders
  add constraint paper_futures_orders_user_order_key unique (user_id, order_id);

alter table public.paper_equity_fills
  add constraint paper_equity_fills_user_order_fk
  foreign key (user_id, order_id)
  references public.paper_orders(user_id, order_id)
  on update restrict on delete restrict not valid;
alter table public.paper_equity_fills
  validate constraint paper_equity_fills_user_order_fk;

alter table public.paper_equity_cash_ledger
  add constraint paper_equity_cash_ledger_user_order_fk
  foreign key (user_id, order_id)
  references public.paper_orders(user_id, order_id)
  on update restrict on delete restrict not valid;
alter table public.paper_equity_cash_ledger
  validate constraint paper_equity_cash_ledger_user_order_fk;

alter table public.paper_equity_cash_ledger
  add constraint paper_equity_cash_ledger_user_fill_fk
  foreign key (user_id, fill_id)
  references public.paper_equity_fills(user_id, fill_id)
  on update restrict on delete restrict not valid;
alter table public.paper_equity_cash_ledger
  validate constraint paper_equity_cash_ledger_user_fill_fk;

alter table public.paper_futures_fills
  add constraint paper_futures_fills_user_order_fk
  foreign key (user_id, order_id)
  references public.paper_futures_orders(user_id, order_id)
  on update restrict on delete restrict not valid;
alter table public.paper_futures_fills
  validate constraint paper_futures_fills_user_order_fk;

-- Options fills intentionally do not duplicate user_id: order_id is the
-- primary key of paper_option_limit_orders, so ownership resolves through
-- exactly one parent order and its owner-scoped RLS policy.

create or replace function public._paper_reject_market_fill_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='55000',
    message='Indian-market fill records are append-only; use compensating records';
end;
$$;
revoke all on function public._paper_reject_market_fill_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists paper_futures_fills_append_only on public.paper_futures_fills;
create trigger paper_futures_fills_append_only
  before update or delete on public.paper_futures_fills
  for each row execute function public._paper_reject_market_fill_mutation();

drop trigger if exists paper_option_limit_fills_append_only on public.paper_option_limit_fills;
create trigger paper_option_limit_fills_append_only
  before update or delete on public.paper_option_limit_fills
  for each row execute function public._paper_reject_market_fill_mutation();

-- Existing Equity triggers remain in place; grants are aligned to immutable rows.
revoke update, delete on public.paper_equity_fills,
  public.paper_equity_cash_ledger, public.paper_futures_fills,
  public.paper_option_limit_fills
  from public, anon, authenticated, service_role;
grant select, insert on public.paper_equity_fills,
  public.paper_equity_cash_ledger, public.paper_futures_fills,
  public.paper_option_limit_fills to service_role;

