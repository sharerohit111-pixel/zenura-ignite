-- Forward-only hardening for NSE cash-equity accounting audit records.
-- Apply after 20261123130000_equity_append_only_fill_cash_ledgers.sql.
-- This migration strengthens referential integrity only; it does not rewire order RPCs.

-- Composite keys ensure an audit row cannot claim another user's order/fill.
alter table public.paper_orders
  add constraint paper_orders_order_user_unique unique (order_id, user_id);

alter table public.paper_equity_fills
  add constraint paper_equity_fills_fill_order_user_unique
    unique (fill_id, order_id, user_id),
  add constraint paper_equity_fills_order_owner_fk
    foreign key (order_id, user_id)
    references public.paper_orders(order_id, user_id)
    on delete restrict;

alter table public.paper_equity_cash_ledger
  add column reversal_of_ledger_id uuid,
  add column reason text;

alter table public.paper_equity_cash_ledger
  add constraint paper_equity_cash_ledger_ledger_user_unique
    unique (ledger_id, user_id);

alter table public.paper_equity_cash_ledger
  add constraint paper_equity_cash_ledger_reversal_owner_fk
    foreign key (reversal_of_ledger_id, user_id)
    references public.paper_equity_cash_ledger(ledger_id, user_id)
    on delete restrict,
  add constraint paper_equity_cash_ledger_order_owner_fk
    foreign key (order_id, user_id)
    references public.paper_orders(order_id, user_id)
    on delete restrict,
  add constraint paper_equity_cash_ledger_fill_order_owner_fk
    foreign key (fill_id, order_id, user_id)
    references public.paper_equity_fills(fill_id, order_id, user_id)
    on delete restrict;

alter table public.paper_equity_cash_ledger
  drop constraint paper_equity_cash_ledger_event_shape;

alter table public.paper_equity_cash_ledger
  drop constraint paper_equity_cash_ledger_event_type_check;

alter table public.paper_equity_cash_ledger
  add constraint paper_equity_cash_ledger_event_type_check
    check (event_type in (
      'TRADE_DEBIT','TRADE_CREDIT','RESERVATION_CREATE',
      'RESERVATION_RELEASE','RESERVATION_CONSUME','ADJUSTMENT','REVERSAL'
    )),
  add constraint paper_equity_cash_ledger_event_shape check (
    (
      event_type='TRADE_DEBIT' and cash_delta_paise<0
      and reserved_cash_delta_paise=0 and fill_id is not null
      and order_id is not null and reversal_of_ledger_id is null
    )
    or
    (
      event_type='TRADE_CREDIT' and cash_delta_paise>0
      and reserved_cash_delta_paise=0 and fill_id is not null
      and order_id is not null and reversal_of_ledger_id is null
    )
    or
    (
      event_type='RESERVATION_CREATE' and cash_delta_paise=0
      and reserved_cash_delta_paise>0 and fill_id is null
      and order_id is not null and reversal_of_ledger_id is null
    )
    or
    (
      event_type in ('RESERVATION_RELEASE','RESERVATION_CONSUME')
      and cash_delta_paise=0 and reserved_cash_delta_paise<0
      and fill_id is null and order_id is not null
      and reversal_of_ledger_id is null
    )
    or
    (
      event_type='ADJUSTMENT' and fill_id is null
      and reversal_of_ledger_id is null
      and reason is not null and length(btrim(reason)) between 3 and 500
    )
    or
    (
      event_type='REVERSAL' and fill_id is null
      and reversal_of_ledger_id is not null
      and reason is not null and length(btrim(reason)) between 3 and 500
      and (cash_delta_paise<>0 or reserved_cash_delta_paise<>0)
    )
  );

-- A source event can be fully reversed only once. Partial/multiple reversals
-- require a separately designed cumulative reversal protocol and are rejected.
create unique index paper_equity_cash_ledger_one_reversal_per_source
  on public.paper_equity_cash_ledger(reversal_of_ledger_id)
  where reversal_of_ledger_id is not null;

create index paper_equity_cash_ledger_reversal_source_idx
  on public.paper_equity_cash_ledger(user_id, reversal_of_ledger_id)
  where reversal_of_ledger_id is not null;

comment on column public.paper_equity_cash_ledger.reversal_of_ledger_id is
  'Original ledger event being fully compensated; only one reversal is allowed per source event.';
comment on column public.paper_equity_cash_ledger.reason is
  'Required operator/system explanation for ADJUSTMENT and REVERSAL events.';
