-- Prevent overlapping live equity protective exits from claiming the same position.
-- OCO is not represented in the current schema, so one live protective order per
-- user/instrument/product is the safe invariant until explicit OCO support exists.
-- Historical terminal rows remain unrestricted.
create unique index if not exists paper_protective_orders_one_live_equity_exit_idx
  on public.paper_protective_orders(user_id,instrument_key,product)
  where asset_class='EQUITY'
    and side='SELL'
    and status in ('ACTIVE','TRIGGERED');
