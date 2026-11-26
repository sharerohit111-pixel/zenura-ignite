#!/usr/bin/env bash
set -euo pipefail

migration_path="${1:?usage: protective_reservation_orphan_migration.sh <reservation-migration.sql>}"
expected_migration="supabase/migrations/20261122153000_reserve_equity_protective_exit_shares.sql"
if [[ "$migration_path" != "$expected_migration" ]]; then
  echo "Unexpected migration path: $migration_path" >&2
  exit 2
fi

user_id="f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0"
orphan_order_id="f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1"
valid_order_id="f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f"
valid_instrument="NSE_EQ|RESERVATION_BACKFILL_VALID"
orphan_instrument="NSE_EQ|RESERVATION_BACKFILL_ORPHAN"

# Seed one real orphan and one valid active order before the migration transaction.
psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$user_id');
INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  '$user_id','DELIVERY','$valid_instrument','RESERVATION_BACKFILL_VALID',
  'NSE',10,10000,100000,1
);
INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES
  ('$orphan_order_id','$user_id','EQUITY','$orphan_instrument','DELIVERY',
   'SELL','STOP_LOSS','AT_OR_BELOW',9000,2,'ACTIVE'),
  ('$valid_order_id','$user_id','EQUITY','$valid_instrument','DELIVERY',
   'SELL','STOP_LOSS','AT_OR_BELOW',9000,2,'ACTIVE');
SQL

# Run the complete migration in a single disposable transaction. The orphan
# preflight must abort it, and PostgreSQL must roll back every statement.
if migration_output="$(psql --single-transaction -v ON_ERROR_STOP=1 -f "$migration_path" 2>&1)"; then
  echo "FAIL: reservation migration accepted an active protective order with no position" >&2
  exit 1
fi
printf '%s\n' "$migration_output"
if ! grep -Fq "Active protective exits have no matching equity position" <<<"$migration_output"; then
  echo "FAIL: migration failed for an unexpected reason" >&2
  exit 1
fi

# The pre-existing fixture rows must survive the aborted transaction unchanged.
psql -v ON_ERROR_STOP=1 <<SQL
DO \$rollback_assertions\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_protective_orders
     WHERE order_id='$orphan_order_id' AND status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Orphan fixture was not preserved after migration rollback';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_equity_positions
     WHERE user_id='$user_id' AND product='DELIVERY'
       AND instrument_key='$valid_instrument' AND quantity=10
       AND reserved_quantity=1
  ) THEN
    RAISE EXCEPTION 'Backfill changed the valid position before migration commit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.paper_equity_positions
     WHERE user_id='$user_id' AND instrument_key='$orphan_instrument'
  ) THEN
    RAISE EXCEPTION 'Orphan fixture unexpectedly acquired a position';
  END IF;
END
\$rollback_assertions\$;
DELETE FROM public.paper_protective_orders WHERE order_id='$orphan_order_id';
SQL

echo "PASS: orphan preflight rejected the migration; transaction rolled back; valid backfill fixture is ready."
