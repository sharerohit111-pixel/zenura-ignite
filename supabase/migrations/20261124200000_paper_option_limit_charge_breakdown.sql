-- DRAFT ONLY. Persist the exact fee components booked by each NSE Options LIMIT fill.
-- Component deltas are derived from the locked order's post-update cumulative turnover.
-- Rates remain the existing simulation schedule; this records provenance, not an assertion
-- that these values are a substitute for a current broker/exchange tariff.
alter table public.paper_option_limit_orders
  add column if not exists charge_schedule_version text not null
    default 'NSE_OPTIONS_SIM_V1_2026_11'
    check (length(charge_schedule_version) between 1 and 80);

alter table public.paper_option_limit_fills
  add column if not exists brokerage_paise bigint not null default 0 check (brokerage_paise>=0),
  add column if not exists exchange_transaction_paise bigint not null default 0 check (exchange_transaction_paise>=0),
  add column if not exists ipft_paise bigint not null default 0 check (ipft_paise>=0),
  add column if not exists sebi_paise bigint not null default 0 check (sebi_paise>=0),
  add column if not exists stamp_duty_paise bigint not null default 0 check (stamp_duty_paise>=0),
  add column if not exists stt_paise bigint not null default 0 check (stt_paise>=0),
  add column if not exists gst_paise bigint not null default 0 check (gst_paise>=0),
  add column if not exists charge_schedule_version text not null
    default 'NSE_OPTIONS_SIM_V1_2026_11'
    check (length(charge_schedule_version) between 1 and 80);

-- Backfill pre-existing immutable fills using the same cumulative-delta method.
-- This preserves historical total charges while making every component auditable.
with ordered_fills as (
  select f.fill_id,f.order_id,f.gross_paise,f.incremental_charges_paise,
         o.side,o.charge_schedule_version,
         sum(f.gross_paise) over (
           partition by f.order_id order by f.fill_sequence
           rows between unbounded preceding and current row
         ) as cumulative_gross
    from public.paper_option_limit_fills f
    join public.paper_option_limit_orders o on o.order_id=f.order_id
), components as (
  select *,
    cumulative_gross-gross_paise as previous_gross,
    case when cumulative_gross>0 then 2000 else 0 end as brokerage_total,
    case when cumulative_gross-gross_paise>0 then 2000 else 0 end as brokerage_previous,
    floor(cumulative_gross::numeric*0.0003552+0.5)::bigint as exchange_total,
    floor((cumulative_gross-gross_paise)::numeric*0.0003552+0.5)::bigint as exchange_previous,
    floor(cumulative_gross::numeric*0.000000001+0.5)::bigint as ipft_total,
    floor((cumulative_gross-gross_paise)::numeric*0.000000001+0.5)::bigint as ipft_previous,
    floor(cumulative_gross::numeric*0.000001+0.5)::bigint as sebi_total,
    floor((cumulative_gross-gross_paise)::numeric*0.000001+0.5)::bigint as sebi_previous,
    case when side='BUY' then floor(cumulative_gross::numeric*0.00003+0.5)::bigint else 0 end as stamp_total,
    case when side='BUY' then floor((cumulative_gross-gross_paise)::numeric*0.00003+0.5)::bigint else 0 end as stamp_previous,
    case when side='SELL' then floor(cumulative_gross::numeric*0.0015+0.5)::bigint else 0 end as stt_total,
    case when side='SELL' then floor((cumulative_gross-gross_paise)::numeric*0.0015+0.5)::bigint else 0 end as stt_previous,
    floor((2000+floor(cumulative_gross::numeric*0.0003552+0.5)
      +floor(cumulative_gross::numeric*0.000000001+0.5))::numeric*0.18+0.5)::bigint as gst_total,
    case when cumulative_gross-gross_paise=0 then 0 else
      floor((2000+floor((cumulative_gross-gross_paise)::numeric*0.0003552+0.5)
        +floor((cumulative_gross-gross_paise)::numeric*0.000000001+0.5))::numeric*0.18+0.5)::bigint
    end as gst_previous
  from ordered_fills
)
update public.paper_option_limit_fills f
   set brokerage_paise=c.brokerage_total-c.brokerage_previous,
       exchange_transaction_paise=c.exchange_total-c.exchange_previous,
       ipft_paise=c.ipft_total-c.ipft_previous,
       sebi_paise=c.sebi_total-c.sebi_previous,
       stamp_duty_paise=c.stamp_total-c.stamp_previous,
       stt_paise=c.stt_total-c.stt_previous,
       gst_paise=c.gst_total-c.gst_previous,
       charge_schedule_version=c.charge_schedule_version
  from components c
 where f.fill_id=c.fill_id
   and f.brokerage_paise=0 and f.exchange_transaction_paise=0
   and f.ipft_paise=0 and f.sebi_paise=0 and f.stamp_duty_paise=0
   and f.stt_paise=0 and f.gst_paise=0;

do $charge_backfill_guard$
begin
  if exists (
    select 1 from public.paper_option_limit_fills
     where brokerage_paise+exchange_transaction_paise+ipft_paise
       +sebi_paise+stamp_duty_paise+stt_paise+gst_paise<>incremental_charges_paise
  ) then
    raise exception 'Historical Options LIMIT fee component backfill does not reconcile.';
  end if;
end
$charge_backfill_guard$;

create or replace function public._record_paper_option_limit_fill_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_side text;
  v_cumulative_gross bigint;
  v_previous_gross bigint;
  v_previous_brokerage bigint;
  v_brokerage bigint;
  v_exchange bigint;
  v_previous_exchange bigint;
  v_ipft bigint;
  v_previous_ipft bigint;
  v_sebi bigint;
  v_previous_sebi bigint;
  v_stamp bigint;
  v_previous_stamp bigint;
  v_stt bigint;
  v_previous_stt bigint;
  v_gst bigint;
  v_previous_gst bigint;
  v_order_schedule text;
  v_component_total numeric;
begin
  select side,cumulative_gross_paise,charge_schedule_version
    into v_side,v_cumulative_gross,v_order_schedule
    from public.paper_option_limit_orders
   where order_id=new.order_id;
  if not found or v_cumulative_gross<new.gross_paise then
    raise exception 'Options fill charge provenance could not resolve its updated parent order.'
      using errcode='23514';
  end if;

  v_previous_gross:=v_cumulative_gross-new.gross_paise;
  v_brokerage:=case when v_cumulative_gross>0 then 2000 else 0 end;
  v_previous_brokerage:=case when v_previous_gross>0 then 2000 else 0 end;
  v_exchange:=floor(v_cumulative_gross::numeric*0.0003552+0.5)::bigint;
  v_previous_exchange:=floor(v_previous_gross::numeric*0.0003552+0.5)::bigint;
  v_ipft:=floor(v_cumulative_gross::numeric*0.000000001+0.5)::bigint;
  v_previous_ipft:=floor(v_previous_gross::numeric*0.000000001+0.5)::bigint;
  v_sebi:=floor(v_cumulative_gross::numeric*0.000001+0.5)::bigint;
  v_previous_sebi:=floor(v_previous_gross::numeric*0.000001+0.5)::bigint;
  v_stamp:=case when v_side='BUY'
    then floor(v_cumulative_gross::numeric*0.00003+0.5)::bigint else 0 end;
  v_previous_stamp:=case when v_side='BUY'
    then floor(v_previous_gross::numeric*0.00003+0.5)::bigint else 0 end;
  v_stt:=case when v_side='SELL'
    then floor(v_cumulative_gross::numeric*0.0015+0.5)::bigint else 0 end;
  v_previous_stt:=case when v_side='SELL'
    then floor(v_previous_gross::numeric*0.0015+0.5)::bigint else 0 end;
  v_gst:=floor((2000+v_exchange+v_ipft)::numeric*0.18+0.5)::bigint;
  v_previous_gst:=case when v_previous_gross=0 then 0
    else floor((2000+v_previous_exchange+v_previous_ipft)::numeric*0.18+0.5)::bigint end;

  new.brokerage_paise:=v_brokerage-v_previous_brokerage;
  new.exchange_transaction_paise:=v_exchange-v_previous_exchange;
  new.ipft_paise:=v_ipft-v_previous_ipft;
  new.sebi_paise:=v_sebi-v_previous_sebi;
  new.stamp_duty_paise:=v_stamp-v_previous_stamp;
  new.stt_paise:=v_stt-v_previous_stt;
  new.gst_paise:=v_gst-v_previous_gst;
  new.charge_schedule_version:=v_order_schedule;

  v_component_total:=new.brokerage_paise+new.exchange_transaction_paise
    +new.ipft_paise+new.sebi_paise+new.stamp_duty_paise
    +new.stt_paise+new.gst_paise;
  if v_component_total<>new.incremental_charges_paise then
    raise exception 'Options fill fee components do not equal the atomic booked charge delta.'
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists paper_option_limit_fill_charge_breakdown
  on public.paper_option_limit_fills;
create trigger paper_option_limit_fill_charge_breakdown
before insert on public.paper_option_limit_fills
for each row execute function public._record_paper_option_limit_fill_charges();

revoke all on function public._record_paper_option_limit_fill_charges()
  from public,anon,authenticated;
grant execute on function public._record_paper_option_limit_fill_charges()
  to service_role;
