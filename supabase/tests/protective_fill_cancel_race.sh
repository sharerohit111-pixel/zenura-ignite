#!/usr/bin/env bash
set -euo pipefail

# Isolate each run so immutable paper-order/fill audit records remain untouched.
USER_ID="$(cat /proc/sys/kernel/random/uuid)"
ORDER_FILL="$(cat /proc/sys/kernel/random/uuid)"
ORDER_CANCEL="$(cat /proc/sys/kernel/random/uuid)"
EXEC_FILL="$(printf '%s' "protective-fill-$USER_ID-$(date +%s%N)" | sha256sum | cut -d' ' -f1)"
EXEC_CANCEL="$(printf '%s' "protective-cancel-$USER_ID-$(date +%s%N)" | sha256sum | cut -d' ' -f1)"
FINGERPRINT_FILL="$(printf '%s' "protective-fill-fingerprint-$USER_ID" | sha256sum | cut -d' ' -f1)"
FINGERPRINT_CANCEL="$(printf '%s' "protective-cancel-fingerprint-$USER_ID" | sha256sum | cut -d' ' -f1)"

wait_for_terminal_update_lock() {
  local pattern="$1"
  for _ in {1..60}; do
    local active
    active="$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%${pattern}%' AND wait_event_type='Timeout' AND wait_event='PgSleep';")"
    if [[ "$active" -ge 1 ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for protective row-lock race stage: ${pattern}" >&2
  exit 1
}


psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$USER_ID') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.paper_accounts(user_id,cash_paise,reserved_cash_paise,reserved_margin_paise)
VALUES ('$USER_ID',100000000,0,0);
DO \$account\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.paper_accounts WHERE user_id='$USER_ID') THEN
    RAISE EXCEPTION 'Protective race test account fixture is missing';
  END IF;
END
\$account\$;

DELETE FROM public.paper_protective_orders
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL');
DELETE FROM public.paper_equity_positions
 WHERE user_id='$USER_ID'
   AND product='DELIVERY' AND instrument_key IN ('NSE_EQ|PROTECTIVE_RACE','NSE_EQ|PROTECTIVE_RACE_CANCEL');
INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  '11111111-1111-4111-8111-111111111111','DELIVERY','NSE_EQ|PROTECTIVE_RACE',
  'PROTECTIVE_RACE','NSE',5,9000,45000,2
),(
  '11111111-1111-4111-8111-111111111111','DELIVERY','NSE_EQ|PROTECTIVE_RACE_CANCEL',
  'PROTECTIVE_RACE_CANCEL','NSE',5,9000,45000,2
);
INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES
 ('d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1','11111111-1111-4111-8111-111111111111',
  'EQUITY','NSE_EQ|PROTECTIVE_RACE','DELIVERY','SELL','STOP_LOSS','AT_OR_BELOW',9000,2,'ACTIVE'),
 ('d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2','11111111-1111-4111-8111-111111111111',
  'EQUITY','NSE_EQ|PROTECTIVE_RACE_CANCEL','DELIVERY','SELL','STOP_LOSS','AT_OR_BELOW',9000,2,'ACTIVE');

CREATE OR REPLACE FUNCTION public.test_delay_protective_terminal_update()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FILLED','CANCELLED') THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
\$\$;
DROP TRIGGER IF EXISTS test_delay_protective_terminal_update ON public.paper_protective_orders;
CREATE TRIGGER test_delay_protective_terminal_update
BEFORE UPDATE ON public.paper_protective_orders
FOR EACH ROW EXECUTE FUNCTION public.test_delay_protective_terminal_update();
SQL

# Fill takes the row lock first. Cancellation must wait and report FILLED.
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_equity_protective_fill(
 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1','$EXEC_FILL','$FINGERPRINT_FILL',8500,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);" >/tmp/zenura-protective-fill-wins.log 2>&1 &
FILL_PID=$!
wait_for_terminal_update_lock "execute_paper_equity_protective_fill"
psql -v ON_ERROR_STOP=1 <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',false);
DO \$cancel_after_fill\$
DECLARE v_result jsonb;
BEGIN
  v_result:=public.cancel_paper_protective_order(
    'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1','11111111-1111-4111-8111-111111111111'
  );
  IF v_result->>'status'<>'FILLED' OR (v_result->>'already_filled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Fill-first race did not preserve FILLED terminal state';
  END IF;
END
\$cancel_after_fill\$;
RESET ROLE;
SQL
wait "$FILL_PID"

# Cancellation takes the row lock first. A waiting fill must reject the CANCELLED order.
psql -v ON_ERROR_STOP=1 <<'SQL' >/tmp/zenura-protective-cancel-wins.log 2>&1 &
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',false);
SELECT public.cancel_paper_protective_order(
 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2','11111111-1111-4111-8111-111111111111'
);
RESET ROLE;
SQL
CANCEL_PID=$!
wait_for_terminal_update_lock "cancel_paper_protective_order"
if psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_equity_protective_fill(
 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2','$EXEC_CANCEL','$FINGERPRINT_CANCEL',8500,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);" >/tmp/zenura-protective-fill-loses.log 2>&1; then
  echo "Fill unexpectedly succeeded after cancellation won the row lock."
  exit 1
fi
wait "$CANCEL_PID"

psql -v ON_ERROR_STOP=1 <<'SQL'
DO \$race_assertions\$
BEGIN
  IF (SELECT status FROM public.paper_protective_orders
      WHERE order_id='d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1')<>'FILLED' THEN
    RAISE EXCEPTION 'Fill-first race did not finish FILLED';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
      WHERE order_id='d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2')<>'CANCELLED' THEN
    RAISE EXCEPTION 'Cancel-first race did not finish CANCELLED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paper_orders WHERE order_id=repeat('a',64) AND status='FILLED') THEN
    RAISE EXCEPTION 'Fill-first race did not create the canonical paper order';
  END IF;
  IF EXISTS(SELECT 1 FROM public.paper_orders WHERE order_id=repeat('c',64)) THEN
    RAISE EXCEPTION 'Cancel-first race created an execution order';
  END IF;
END
\$race_assertions\$;

DROP TRIGGER IF EXISTS test_delay_protective_terminal_update ON public.paper_protective_orders;
DROP FUNCTION IF EXISTS public.test_delay_protective_terminal_update();
-- Keep the isolated account, protective orders, positions and immutable execution rows for auditability.
SQL
