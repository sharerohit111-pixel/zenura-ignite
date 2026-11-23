-- Grant only the direct read/write privileges required by the Supabase market gateway.
-- Internal provider, worker and order tables remain inaccessible to anon/authenticated.
-- Forward-only and draft-only: rehearse in disposable staging before any shared deployment.

GRANT SELECT ON TABLE
  public.upstox_connections,
  public.paper_market_worker_state,
  public.paper_orders,
  public.paper_protective_orders,
  public.paper_equity_positions
TO service_role;

GRANT UPDATE ON TABLE
  public.paper_market_worker_state,
  public.paper_protective_orders
TO service_role;
