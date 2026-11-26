-- Forward-only protective-order cancellation with row-level serialization against fills.
-- A cancellation and an equity fill lock the same order row; exactly one terminal state wins.
-- Authenticated users may cancel only their own ACTIVE/TRIGGERED orders.
-- Draft PR only: this migration is not applied to production.

alter table public.paper_protective_orders
  add column if not exists cancelled_at timestamptz;

create or replace function public.cancel_paper_protective_order(
  p_protective_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_protective_orders%rowtype;
begin
  if p_protective_order_id is null or p_user_id is null or auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='Authenticated ownership is required';
  end if;

  select * into v_order
    from public.paper_protective_orders
   where order_id=p_protective_order_id
   for update;

  if not found then
    raise exception using errcode='P0002', message='Protective order not found';
  end if;

  if v_order.user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='Protective order does not belong to the authenticated user';
  end if;

  if v_order.status='CANCELLED' then
    return jsonb_build_object('status','CANCELLED','idempotent_replay',true);
  end if;

  if v_order.status='FILLED' then
    return jsonb_build_object('status','FILLED','already_filled',true,'idempotent_replay',false);
  end if;

  if v_order.status not in ('ACTIVE','TRIGGERED') then
    return jsonb_build_object('status',v_order.status,'cancelled',false,'not_cancellable',true);
  end if;

  update public.paper_protective_orders
     set status='CANCELLED',cancelled_at=now(),updated_at=now()
   where order_id=p_protective_order_id;

  return jsonb_build_object('status','CANCELLED','cancelled',true,'idempotent_replay',false);
end;
$$;

revoke all on function public.cancel_paper_protective_order(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.cancel_paper_protective_order(uuid,uuid)
  to authenticated;
