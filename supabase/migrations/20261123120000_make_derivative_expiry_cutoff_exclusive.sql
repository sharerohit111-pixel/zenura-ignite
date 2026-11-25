-- Forward-only correction: derivative orders must be rejected at or after the
-- exchange-local expiry cutoff (15:30 Asia/Kolkata), not one millisecond later.
-- Draft only; disposable migration CI validates this patch before any rollout.

do $migration$
declare
  v_signature regprocedure;
  v_definition text;
  v_patched text;
  v_matches integer;
  v_signatures text[] := array[
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)',
    'public.execute_paper_futures_market_order(uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,bigint)'
  ];
begin
  foreach v_signature in array v_signatures::regprocedure[] loop
    v_definition := pg_get_functiondef(v_signature);
    select count(*) into v_matches
      from regexp_matches(
        v_definition,
        'v_server_now_ms[[:space:]]*>[[:space:]]*v_expiry_cutoff_ms',
        'g'
      );
    if v_matches<>1 then
      raise exception 'Expected exactly one inclusive expiry cutoff comparison in %; found %',
        v_signature,v_matches;
    end if;
    v_patched := regexp_replace(
      v_definition,
      'v_server_now_ms[[:space:]]*>[[:space:]]*v_expiry_cutoff_ms',
      'v_server_now_ms>=v_expiry_cutoff_ms',
      'g'
    );
    if v_patched=v_definition
       or position('v_server_now_ms>=v_expiry_cutoff_ms' in v_patched)=0 then
      raise exception 'Could not enforce exclusive derivative expiry cutoff in %',v_signature;
    end if;
    execute v_patched;
  end loop;
end
$migration$;
