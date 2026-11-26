-- Disposable schema guard: F&O LIMIT must remain fail-closed until its
-- reservation/fill/cancel lifecycle and worker are implemented and tested.
-- This test does not change schema or production data.
begin;

do $guard$
declare
  v_order_type_check text;
  v_status_check text;
  v_option_quantity_check text;
  v_futures_quantity_check text;
begin
  select pg_get_constraintdef(c.oid) into v_order_type_check
    from pg_constraint c
   where c.conrelid='public.paper_derivative_orders'::regclass
     and c.contype='c'
     and pg_get_constraintdef(c.oid) ilike '%order_type%'
   order by c.oid
   limit 1;

  if v_order_type_check is null
     or position('MARKET' in v_order_type_check)=0
     or position('LIMIT' in v_order_type_check)>0 then
    raise exception 'Long Options order table must remain MARKET-only until LIMIT lifecycle release';
  end if;

  select pg_get_constraintdef(c.oid) into v_status_check
    from pg_constraint c
   where c.conrelid='public.paper_derivative_orders'::regclass
     and c.contype='c'
     and pg_get_constraintdef(c.oid) ilike '%status%'
   order by c.oid
   limit 1;

  if v_status_check is null
     or position('FILLED' in v_status_check)=0
     or position('REJECTED' in v_status_check)=0
     or position('PENDING' in v_status_check)>0
     or position('CANCELLED' in v_status_check)>0 then
    raise exception 'Long Options receipt status constraint was weakened before a complete LIMIT lifecycle exists';
  end if;

  select pg_get_constraintdef(c.oid) into v_option_quantity_check
    from pg_constraint c
   where c.conrelid='public.paper_derivative_positions'::regclass
     and c.contype='c'
     and pg_get_constraintdef(c.oid) ilike '%net_quantity%'
   order by c.oid
   limit 1;

  if v_option_quantity_check is null
     or position('net_quantity > 0' in v_option_quantity_check)=0 then
    raise exception 'Long Options positions must remain long-only; do not reuse them for signed Futures exposure';
  end if;

  select pg_get_constraintdef(c.oid) into v_futures_quantity_check
    from pg_constraint c
   where c.conrelid='public.paper_futures_positions'::regclass
     and c.contype='c'
     and pg_get_constraintdef(c.oid) ilike '%net_quantity%'
   order by c.oid
   limit 1;

  if v_futures_quantity_check is null
     or position('net_quantity <> 0' in v_futures_quantity_check)=0 then
    raise exception 'Futures positions must preserve signed non-zero net quantity semantics';
  end if;
end
$guard$;

rollback;
