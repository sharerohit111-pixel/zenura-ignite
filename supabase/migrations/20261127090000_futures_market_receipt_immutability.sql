-- Protect completed Futures MARKET receipts from mutation.
-- LIMIT orders retain their existing pending/fill/cancel lifecycle.
create or replace function public._guard_paper_futures_market_receipt_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    if old.order_type='MARKET' then
      raise exception 'Completed Futures MARKET receipts are immutable.'
        using errcode='55000';
    end if;
    return old;
  end if;

  if old.order_type='MARKET' or new.order_type='MARKET' then
    raise exception 'Completed Futures MARKET receipts are immutable.'
      using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists paper_futures_market_receipt_immutable
  on public.paper_futures_orders;
create trigger paper_futures_market_receipt_immutable
before update or delete on public.paper_futures_orders
for each row execute function public._guard_paper_futures_market_receipt_immutable();

revoke all on function public._guard_paper_futures_market_receipt_immutable()
  from public,anon,authenticated;

comment on function public._guard_paper_futures_market_receipt_immutable() is
  'Rejects UPDATE/DELETE of completed Futures MARKET receipts while preserving LIMIT order lifecycle mutations.';
