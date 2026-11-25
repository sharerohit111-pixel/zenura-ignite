-- DRAFT ONLY. Stamp the existing immutable Options MARKET receipt breakdown
-- with the exact simulation fee schedule version used by its SQL accounting RPC.
do $migration$
declare
  v_signature regprocedure :=
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'::regprocedure;
  v_definition text;
  v_old text := $old$'segment','EQUITY_OPTIONS','indicative',true,'simulationOnly',true$old$;
  v_new text := $new$'segment','EQUITY_OPTIONS','chargeScheduleVersion','NSE_OPTIONS_MARKET_SIM_V1_2026_11','indicative',true,'simulationOnly',true$new$;
begin
  v_definition:=pg_get_functiondef(v_signature);
  if position(v_new in v_definition)>0 then
    return;
  end if;
  if position(v_old in v_definition)=0
     or position(v_old in substring(v_definition from position(v_old in v_definition)+length(v_old)))>0 then
    raise exception 'Expected unique Options MARKET charge-breakdown fragment was not found exactly once.';
  end if;
  execute replace(v_definition,v_old,v_new);
end
$migration$;
