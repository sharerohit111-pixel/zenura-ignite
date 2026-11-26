import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/20261122153000_reserve_equity_protective_exit_shares.sql', import.meta.url),
  'utf8'
);

test('protective reservation migration rejects active equity SELL orders without a matching position before backfill', () => {
  const block = migration.match(/do \$reservation_backfill\$([\s\S]*?)\$reservation_backfill\$;/i);
  assert.ok(block, 'reservation backfill preflight block must exist');
  const sql = block[1];
  const orphanGuard = sql.indexOf('not exists');
  const insufficientSharesGuard = sql.indexOf('having ep.quantity-ep.reserved_quantity<sum(po.quantity)');
  const backfill = migration.indexOf('update public.paper_equity_positions ep');
  assert.notEqual(orphanGuard, -1, 'orphan protective exits must be checked');
  assert.notEqual(insufficientSharesGuard, -1, 'existing insufficient-share guard must remain');
  assert.ok(orphanGuard < insufficientSharesGuard, 'orphan guard must run inside preflight before share aggregation guard');
  assert.ok(migration.indexOf('$reservation_backfill$;') < backfill, 'all preflight guards must execute before reservation UPDATE');
  for (const key of ['ep.user_id=po.user_id', 'ep.instrument_key=po.instrument_key', 'ep.product=po.product']) {
    assert.ok(sql.includes(key), `orphan check must match position key ${key}`);
  }
  assert.match(sql, /po\.asset_class='EQUITY'[\s\S]*po\.side='SELL'[\s\S]*po\.status in \('ACTIVE','TRIGGERED'\)/);
  assert.match(sql, /raise exception 'Active protective exits have no matching equity position/);
});
