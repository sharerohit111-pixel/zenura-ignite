-- Retire only the dedicated Paper Investing ledger under the approved Paper Trading-only scope.
-- This is forward-only: do not rewrite migrations already recorded in remote history.
-- No CASCADE is used so any unexpected shared dependency fails the migration safely.

drop function if exists public.execute_paper_investing_market_order(
  uuid,text,uuid,text,text,text,text,text,integer,bigint,integer,bigint,bigint,bigint
);
drop function if exists public.initialize_paper_investing_account(uuid);

drop table if exists public.paper_investing_orders;
drop table if exists public.paper_investing_positions;
drop table if exists public.paper_investing_accounts;
