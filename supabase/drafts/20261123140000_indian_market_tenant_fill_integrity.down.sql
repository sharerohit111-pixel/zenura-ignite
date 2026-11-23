-- DRAFT ROLLBACK for 20261123140000_indian_market_tenant_fill_integrity.sql
-- Disposable environments only; stop settlement workers before running.

begin;
drop trigger if exists paper_option_limit_fills_append_only on public.paper_option_limit_fills;
drop trigger if exists paper_futures_fills_append_only on public.paper_futures_fills;
drop function if exists public._paper_reject_market_fill_mutation();

alter table public.paper_futures_fills drop constraint if exists paper_futures_fills_user_order_fk;
alter table public.paper_equity_cash_ledger drop constraint if exists paper_equity_cash_ledger_user_fill_fk;
alter table public.paper_equity_cash_ledger drop constraint if exists paper_equity_cash_ledger_user_order_fk;
alter table public.paper_equity_fills drop constraint if exists paper_equity_fills_user_order_fk;

alter table public.paper_futures_orders drop constraint if exists paper_futures_orders_user_order_key;
alter table public.paper_equity_fills drop constraint if exists paper_equity_fills_user_fill_key;
alter table public.paper_orders drop constraint if exists paper_orders_user_order_key;

-- Restore the pre-hardening Futures/Options service-role DML ACLs.
grant select, insert, update, delete on public.paper_futures_fills to service_role;
grant select, insert, update, delete on public.paper_option_limit_fills to service_role;
commit;
