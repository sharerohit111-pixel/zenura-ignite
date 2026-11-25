-- Disposable schema/security regression for the isolated NSE Options LIMIT ledger.
begin;

do $options_limit_schema$
declare
  v_definition text;
  v_rls boolean;
begin
  if to_regclass('public.paper_option_limit_orders') is null
     or to_regclass('public.paper_option_limit_fills') is null then
    raise exception 'Dedicated Options LIMIT tables are missing';
  end if;

  select c.relrowsecurity into v_rls
    from pg_class c where c.oid='public.paper_option_limit_orders'::regclass;
  if v_rls is distinct from true then
    raise exception 'Options LIMIT orders must have RLS enabled';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c where c.oid='public.paper_option_limit_fills'::regclass;
  if v_rls is distinct from true then
    raise exception 'Options LIMIT fills must have RLS enabled';
  end if;

  if not has_table_privilege('authenticated','public.paper_option_limit_orders','SELECT')
     or has_table_privilege('authenticated','public.paper_option_limit_orders','INSERT')
     or has_table_privilege('authenticated','public.paper_option_limit_orders','UPDATE')
     or has_table_privilege('authenticated','public.paper_option_limit_fills','INSERT')
     or has_table_privilege('authenticated','public.paper_option_limit_fills','UPDATE')
     or has_table_privilege('authenticated','public.paper_option_limit_fills','DELETE') then
    raise exception 'Options LIMIT browser grants are not read-only';
  end if;

  if not has_table_privilege('service_role','public.paper_option_limit_orders','INSERT')
     or not has_table_privilege('service_role','public.paper_option_limit_orders','UPDATE')
     or not has_table_privilege('service_role','public.paper_option_limit_fills','INSERT')
     or has_table_privilege('service_role','public.paper_option_limit_fills','UPDATE')
     or has_table_privilege('service_role','public.paper_option_limit_fills','DELETE') then
    raise exception 'Options LIMIT service-role grants violate the append-only fill ledger contract';
  end if;

  select pg_get_constraintdef(c.oid) into v_definition
    from pg_constraint c
   where c.conrelid='public.paper_derivative_positions'::regclass
     and c.conname='paper_derivative_positions_reserved_not_over_held';
  if v_definition is null or position('reserved_quantity <= net_quantity' in v_definition)=0 then
    raise exception 'Option close reservations must never exceed held long quantity';
  end if;

  select pg_get_functiondef(
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'::regprocedure
  ) into v_definition;
  if position('v_old_qty-coalesce(v_position.reserved_quantity,0)<v_quantity' in v_definition)=0 then
    raise exception 'Existing MARKET SELL must respect long-option LIMIT close reservations';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='paper_option_limit_orders_worker_scan_idx'
  ) then
    raise exception 'Options LIMIT worker scan index is missing';
  end if;

  select pg_get_functiondef(
    'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)'::regprocedure
  ) into v_definition;
  if position('paper_option_limit_orders' in v_definition)=0
     or position('paper_futures_limit_orders' in v_definition)=0 then
    raise exception 'Derivative LIMIT worker lease keys are not registered';
  end if;
  select pg_get_functiondef(
    'public.release_paper_market_worker_lease(text,uuid,bigint)'::regprocedure
  ) into v_definition;
  if position('paper_option_limit_orders' in v_definition)=0
     or position('paper_futures_limit_orders' in v_definition)=0 then
    raise exception 'Derivative LIMIT worker lease release keys are not registered';
  end if;

  -- Trusted gateway reads are service-role-only; internal worker state is writable only by service_role.
  if not has_table_privilege('service_role','public.upstox_connections','SELECT')
     or not has_table_privilege('service_role','public.paper_market_worker_state','SELECT')
     or not has_table_privilege('service_role','public.paper_market_worker_state','UPDATE')
     or not has_table_privilege('service_role','public.paper_orders','SELECT')
     or not has_table_privilege('service_role','public.paper_protective_orders','SELECT')
     or not has_table_privilege('service_role','public.paper_protective_orders','UPDATE')
     or not has_table_privilege('service_role','public.paper_equity_positions','SELECT') then
    raise exception 'Trusted market gateway service-role read/update grants are incomplete';
  end if;
  if has_table_privilege('authenticated','public.upstox_connections','SELECT')
     or has_table_privilege('anon','public.upstox_connections','SELECT')
     or has_table_privilege('authenticated','public.paper_market_worker_state','SELECT')
     or has_table_privilege('anon','public.paper_market_worker_state','SELECT') then
    raise exception 'Internal Upstox credentials/worker state must remain inaccessible to client roles';
  end if;

  -- The existing derivative receipt remains MARKET-only and terminal.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid='public.paper_derivative_orders'::regclass
       and c.contype='c'
       and pg_get_constraintdef(c.oid) ilike '%order_type%'
       and position('MARKET' in pg_get_constraintdef(c.oid))>0
       and position('LIMIT' in pg_get_constraintdef(c.oid))=0
  ) then
    raise exception 'Existing Options MARKET-only receipt constraint was weakened';
  end if;
end
$options_limit_schema$;

rollback;
