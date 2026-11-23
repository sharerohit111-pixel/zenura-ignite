-- Restore the narrowly scoped server-side privileges required by the trusted market gateway.
-- No client-role access is granted; RLS and owner-scoped browser access remain unchanged.

grant select on table
  public.upstox_connections,
  public.paper_market_worker_state,
  public.paper_orders,
  public.paper_protective_orders,
  public.paper_equity_positions
to service_role;

grant update on table
  public.paper_market_worker_state,
  public.paper_protective_orders
to service_role;
