-- Partial index keeps the bounded protective scan fair: least-recently-evaluated ACTIVE
-- equity exits are reconsidered first. This migration is forward-only and draft-only.
create index if not exists paper_protective_orders_worker_scan_idx
  on public.paper_protective_orders(last_evaluated_quote_at_ms,created_at,order_id)
  where status='ACTIVE' and asset_class='EQUITY' and side='SELL'
    and product in ('DELIVERY','INTRADAY');
