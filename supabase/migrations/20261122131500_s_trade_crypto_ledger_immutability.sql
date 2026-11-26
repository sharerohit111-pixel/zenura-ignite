-- S-TRADE ledger hardening: crypto cash ledger is strictly append-only.
-- This migration does not touch account balances, positions, orders or existing app modules.

create or replace function public.reject_paper_crypto_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Crypto cash ledger entries are append-only.'
    using errcode = '55000';
end;
$$;

drop trigger if exists paper_crypto_ledger_immutable
  on public.paper_crypto_ledger;

create trigger paper_crypto_ledger_immutable
before update or delete on public.paper_crypto_ledger
for each row execute function public.reject_paper_crypto_ledger_mutation();

revoke all on function public.reject_paper_crypto_ledger_mutation()
  from public, anon, authenticated;

revoke update, delete on public.paper_crypto_ledger from service_role;
grant select, insert on public.paper_crypto_ledger to service_role;

comment on function public.reject_paper_crypto_ledger_mutation()
  is 'Prevents updates and deletes to the S-TRADE crypto cash ledger, including privileged service-role mutations.';
