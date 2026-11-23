-- DRAFT ONLY. Fail closed when an Options LIMIT expiry scan lacks a verified NSE session.
-- This additive patch preserves an order's reservation when the calendar is unavailable
-- before its explicit expiry timestamp / contract cutoff. It does not alter order routing.

do $migration$
declare
  v_signature regprocedure :=
    'public._release_paper_option_limit_order(text,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text := $old$      if found and v_local_minute>=v_session.open_minute
         and v_local_minute<v_session.close_minute then
        raise exception 'Options LIMIT order is still inside a verified NSE session.' using errcode='22023';
      end if;$old$;
  v_new text := $new$      if not found then
        raise exception 'A verified NSE session is required before early Options LIMIT expiry.' using errcode='22023';
      end if;
      if v_local_minute<v_session.close_minute then
        raise exception 'Options LIMIT order is still before the verified NSE session close.' using errcode='22023';
      end if;$new$;
begin
  v_definition := pg_get_functiondef(v_signature);
  if position(v_new in v_definition)>0 then
    return;
  end if;
  if position(v_old in v_definition)=0 then
    raise exception 'Expected Options LIMIT expiry calendar guard was not found exactly as designed';
  end if;
  v_patched := replace(v_definition,v_old,v_new);
  if v_patched=v_definition or position(v_new in v_patched)=0 then
    raise exception 'Could not safely harden Options LIMIT expiry calendar guard';
  end if;
  execute v_patched;
end
$migration$;
