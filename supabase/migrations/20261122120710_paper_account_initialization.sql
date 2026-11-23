-- DRAFT ONLY — do not apply before staging review and explicit approval.
-- Idempotent one-time Paper Trading account provisioning.
-- A retry MUST NEVER reset an existing user's cash, positions, reservations or P&L.

create or replace function public.initialize_paper_trading_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_created boolean := false;
begin
  if p_user_id is null then
    raise exception using errcode='22023', message='A valid Supabase user ID is required';
  end if;

  insert into public.paper_accounts(
    user_id,currency,starting_cash_paise,cash_paise,reserved_cash_paise,
    reserved_margin_paise,realized_pnl_paise,delivery_realized_pnl_paise,
    intraday_realized_pnl_paise,version,created_at,updated_at
  ) values (
    p_user_id,'INR',100000000,100000000,0,0,0,0,0,1,now(),now()
  )
  on conflict (user_id) do nothing
  returning * into v_account;

  if found then
    v_created := true;
  else
    -- Serialize with concurrent initialization and any subsequent account mutation.
    select * into v_account from public.paper_accounts
     where user_id=p_user_id for update;
    if not found then
      raise exception using errcode='P0002', message='Paper account could not be initialized';
    end if;
  end if;

  if v_account.currency<>'INR'
     or v_account.starting_cash_paise<=0
     or v_account.cash_paise<0
     or v_account.reserved_cash_paise<0
     or v_account.reserved_margin_paise<0
     or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_account.cash_paise
     or v_account.version<1 then
    raise exception using errcode='23514', message='Existing Paper Trading account state is invalid';
  end if;

  return jsonb_build_object(
    'user_id',v_account.user_id,
    'currency',v_account.currency,
    'starting_cash_paise',v_account.starting_cash_paise,
    'cash_paise',v_account.cash_paise,
    'reserved_cash_paise',v_account.reserved_cash_paise,
    'reserved_margin_paise',v_account.reserved_margin_paise,
    'realized_pnl_paise',v_account.realized_pnl_paise,
    'version',v_account.version,
    'created',v_created,
    'simulation_only',true
  );
end;
$$;

revoke all on function public.initialize_paper_trading_account(uuid)
  from public, anon, authenticated;
grant execute on function public.initialize_paper_trading_account(uuid)
  to service_role;
