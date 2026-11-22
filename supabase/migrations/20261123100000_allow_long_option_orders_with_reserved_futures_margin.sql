-- Forward-only correction: long-option premium orders share the account with futures.
-- Existing futures margin must remain reserved, not disable unrelated option BUYs.
-- The option transaction already checks cash after preserving both cash and margin reservations.
-- Draft only: validate through the disposable migration workflow before any staging/prod rollout.

do $migration$
declare
  v_signature regprocedure :=
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'::regprocedure;
  v_definition text;
  v_patched text;
  v_matches integer;
  v_pattern text := E'\n[[:space:]]*or v_account\\.reserved_margin_paise[[:space:]]*<>[[:space:]]*0';
begin
  v_definition := pg_get_functiondef(v_signature);
  select count(*) into v_matches
    from regexp_matches(v_definition,v_pattern,'g');
  if v_matches<>1 then
    raise exception 'Expected exactly one obsolete zero-futures-margin guard in execute_paper_long_option_order; found %',v_matches;
  end if;

  v_patched := regexp_replace(v_definition,v_pattern,'','g');
  if v_patched=v_definition
     or position('v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_account.cash_paise' in v_patched)=0
     or position('v_cash < v_account.reserved_cash_paise+v_account.reserved_margin_paise' in v_patched)=0 then
    raise exception 'Option/futures shared-cash safety checks were not preserved by the migration';
  end if;

  execute v_patched;
end
$migration$;
