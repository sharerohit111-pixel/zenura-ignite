-- S-TRADE Crypto account reset.
-- Reset the user's virtual balance and open exposure while preserving immutable order/ledger history.
-- Draft migration: apply only to isolated staging after review.

create table if not exists public.paper_crypto_account_resets (
  reset_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  previous_cash numeric(24,8) not null,
  reset_cash numeric(24,8) not null,
  previous_realized_pnl numeric(24,8) not null,
  cancelled_limit_orders integer not null check (cancelled_limit_orders >= 0),
  closed_positions integer not null check (closed_positions >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.paper_crypto_account_resets enable row level security;
revoke all on public.paper_crypto_account_resets from public, anon, authenticated;
grant select, insert on public.paper_crypto_account_resets to service_role;

create or replace function public.reset_paper_crypto_account(
  p_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_crypto_accounts%rowtype;
  v_existing public.paper_crypto_account_resets%rowtype;
  v_order public.paper_crypto_orders%rowtype;
  v_cancelled integer := 0;
  v_positions integer := 0;
  v_previous_cash numeric(24,8);
  v_previous_realized numeric(24,8);
  v_reset_id uuid;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'A valid Crypto account and reset request ID are required.' using errcode = '22023';
  end if;

  select * into v_account
    from public.paper_crypto_accounts
   where user_id = p_user_id
   for update;
  if not found then
    raise exception 'Crypto paper account is not initialized.' using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.paper_crypto_account_resets
   where user_id = p_user_id and request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'reset_id', v_existing.reset_id,
      'cash_balance', v_existing.reset_cash,
      'cancelled_limit_orders', v_existing.cancelled_limit_orders,
      'closed_positions', v_existing.closed_positions,
      'idempotent_replay', true,
      'history_preserved', true,
      'simulation_only', true
    );
  end if;

  v_previous_cash := v_account.cash_balance;
  v_previous_realized := v_account.realized_pnl;

  -- Cancel every pending LIMIT order through the canonical cancellation RPC
  -- so both INR and base-quantity reservations are released atomically.
  for v_order in
    select * from public.paper_crypto_orders
     where user_id = p_user_id and order_type = 'LIMIT' and status = 'PENDING'
     order by created_at, order_id
     for update
  loop
    perform public.cancel_paper_crypto_limit_order(p_user_id, v_order.order_id);
    v_cancelled := v_cancelled + 1;
  end loop;

  select count(*)::integer into v_positions
    from public.paper_crypto_positions
   where user_id = p_user_id;

  if exists (
    select 1 from public.paper_crypto_accounts
     where user_id = p_user_id and reserved_cash <> 0
  ) or exists (
    select 1 from public.paper_crypto_positions
     where user_id = p_user_id and coalesce(reserved_quantity, 0) <> 0
  ) or exists (
    select 1 from public.paper_crypto_orders
     where user_id = p_user_id and order_type = 'LIMIT' and status = 'PENDING'
  ) then
    raise exception 'Crypto account reset blocked because an order reservation remains.' using errcode = '23514';
  end if;

  delete from public.paper_crypto_positions where user_id = p_user_id;

  update public.paper_crypto_accounts
     set cash_balance = starting_cash,
         reserved_cash = 0,
         realized_pnl = 0,
         version = version + 1,
         updated_at = now()
   where user_id = p_user_id
   returning * into v_account;

  v_reset_id := gen_random_uuid();
  insert into public.paper_crypto_account_resets(
    reset_id, user_id, request_id, previous_cash, reset_cash,
    previous_realized_pnl, cancelled_limit_orders, closed_positions
  ) values (
    v_reset_id, p_user_id, p_request_id, v_previous_cash, v_account.cash_balance,
    v_previous_realized, v_cancelled, v_positions
  );

  return jsonb_build_object(
    'reset_id', v_reset_id,
    'cash_balance', v_account.cash_balance,
    'cancelled_limit_orders', v_cancelled,
    'closed_positions', v_positions,
    'idempotent_replay', false,
    'history_preserved', true,
    'simulation_only', true
  );
end;
$$;

revoke all on function public.reset_paper_crypto_account(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reset_paper_crypto_account(uuid,uuid) to service_role;

comment on table public.paper_crypto_account_resets is
  'Audit trail for virtual Crypto account resets. Resets close positions and cancel pending LIMIT orders but preserve immutable order and trade-ledger history.';
