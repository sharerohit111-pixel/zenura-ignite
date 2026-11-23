-- Prevent MARKET sells or other privileged deletes from destroying a position
-- while quantity is reserved by one or more pending Crypto LIMIT sell orders.
-- The existing reserved_quantity <= quantity CHECK protects updates; DELETE
-- needs an explicit guard because row deletion bypasses that CHECK.
create or replace function public.reject_paper_crypto_reserved_position_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(old.reserved_quantity, 0) > 0 then
    raise exception 'Cannot delete a crypto position while quantity is reserved by a pending LIMIT order.'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists paper_crypto_reserved_position_delete_guard
  on public.paper_crypto_positions;

create trigger paper_crypto_reserved_position_delete_guard
before delete on public.paper_crypto_positions
for each row execute function public.reject_paper_crypto_reserved_position_delete();

revoke all on function public.reject_paper_crypto_reserved_position_delete()
  from public, anon, authenticated;

comment on function public.reject_paper_crypto_reserved_position_delete()
  is 'Prevents deleting a crypto position while any base quantity remains reserved by a pending LIMIT sell order.';
