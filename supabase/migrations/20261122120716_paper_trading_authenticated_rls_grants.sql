-- Restore only the table privileges required by the browser's Firebase-authenticated
-- Supabase JWT. RLS policies remain the row-level authorization boundary.
-- Trading/account writes remain service-role RPC-only; provider and identity tables
-- remain inaccessible to anon/authenticated roles.

revoke all on public.paper_accounts,
  public.paper_equity_positions,
  public.paper_derivative_positions,
  public.paper_orders,
  public.paper_derivative_orders,
  public.paper_watchlists
  from anon, authenticated;

grant select on public.paper_accounts,
  public.paper_equity_positions,
  public.paper_derivative_positions,
  public.paper_orders,
  public.paper_derivative_orders
  to authenticated;

grant select, insert, update, delete on public.paper_watchlists
  to authenticated;
