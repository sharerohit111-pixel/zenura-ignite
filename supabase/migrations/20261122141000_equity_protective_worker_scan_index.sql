-- Add a separate scheduler scan timestamp. It is intentionally distinct from the
-- provider quote timestamp so stale/missing quotes cannot starve later orders.
alter table public.paper_protective_orders
  add column if not exists worker_checked_at timestamptz;

create index if not exists paper_protective_orders_worker_scan_idx
  on public.paper_protective_orders(worker_checked_at,created_at,order_id)
  where status='ACTIVE' and asset_class='EQUITY' and side='SELL'
    and product in ('DELIVERY','INTRADAY');
