import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../supabase/migrations/20261122153000_reserve_equity_protective_exit_shares.sql'
);
const migration = readFileSync(migrationPath, 'utf8');

test('protective reservation migration rejects active exits without a matching position', () => {
  const orphanGuard = migration.match(
    /if exists\s*\([\s\S]*?from public\.paper_protective_orders po[\s\S]*?left join public\.paper_equity_positions ep[\s\S]*?where[\s\S]*?po\.status in \('ACTIVE','TRIGGERED'\)[\s\S]*?ep\.user_id is null[\s\S]*?\)\s*then\s*raise exception '([^']+)'/i
  );
  assert.ok(orphanGuard, 'orphan guard must explicitly LEFT JOIN positions and reject NULL position owners');
  assert.match(
    orphanGuard[1],
    /^An active equity protective exit has no matching position\b/,
    'orphan guard must fail with the expected protective-exit reconciliation error'
  );

  const backfillAt = migration.indexOf('update public.paper_equity_positions ep');
  const guardAt = migration.indexOf(orphanGuard[0]);
  assert.ok(backfillAt > guardAt, 'orphan validation must run before the reservation UPDATE');

  const aggregateGuardAt = migration.indexOf('having ep.quantity-ep.reserved_quantity<sum(po.quantity)');
  assert.ok(aggregateGuardAt > guardAt, 'existing over-reservation validation must remain in place');
});
