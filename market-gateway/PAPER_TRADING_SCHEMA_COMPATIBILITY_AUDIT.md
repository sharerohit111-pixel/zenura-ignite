# Paper Trading Supabase schema compatibility audit

Audit date: 2026-11-22  
Scope: PR #70 (migration/supabase-paper-trading-schema-draft-2026-11-22), PR #74
(migration/firebase-third-party-auth-rls-2026-11-22), and the offline transformer in PR #77.
No database changes or imports were performed.

## Executive finding: do not combine the two core-schema variants

Both PR #70 and PR #74 are open Draft PRs and contain the same migration filenames, but
their schema and RPC definitions are not interchangeable.

### Identity architecture conflict

PR #70 migration 202611220001_paper_trading_core_schema.sql:
- Makes paper_user_identity_map.supabase_user_id reference auth.users(id).
- Makes account and related user rows reference auth.users(id).
- Uses auth.uid() = user_id in RLS.
- This does not match the selected Firebase third-party JWT design where the Firebase sub
  is a string and is mapped to a separate stable internal relational UUID.

PR #74 migration 202611220001_paper_trading_core_schema.sql:
- Keeps a private identity map with supabase_user_id as an internal UUID and firebase_uid
  as the unique Firebase string subject.
- Child Paper Trading tables reference paper_user_identity_map(supabase_user_id).
- Defines current_paper_user_id() as a SECURITY DEFINER resolver from
  auth.jwt()->>'sub' to the private identity map.
- RLS policies use that resolver; the identity map itself is not exposed to browser roles.
- This matches the Firebase UID → pre-provisioned UUID mapping emitted by the PR #77 transformer.

Decision for the next integration pass: use PR #74's identity-map/Firebase-JWT architecture as
the canonical candidate. Do not merge or apply PR #70's older auth.users-referencing core
schema alongside it. Preserve Firebase Auth as the identity provider; do not create duplicate
Supabase Auth users merely to satisfy the stale foreign keys.

## Transaction migration comparison

Migrations 202611220002 through 202611220005 also differ between the branches; they are
not byte-identical. The PR #74 versions include additional hardening observed in source diffs:
- SECURITY DEFINER functions pin an empty search_path instead of pg_catalog, public.
- MARKET order RPC derives quote age from the PostgreSQL clock and rejects future/stale quotes
  and materially mismatched caller-supplied quote age.
- LIMIT fill validates caller clock skew, future quote timestamps and database-derived quote age.
- Long-option RPC derives freshness and expiry decisions from the database clock and rejects
  a caller clock outside its allowed tolerance.

Use the complete PR #74 migration set and its matching PostgreSQL smoke-test workflow as the
review candidate; do not cherry-pick only the core schema from one branch and stale RPCs or
workflow assumptions from the other. The PR #74 workflow stubs Firebase auth.jwt() claims
and exercises identity-map RLS, server-only RPC grants, quote boundaries, and concurrency
scenarios. The PR #70 workflow instead stubs auth.users/auth.uid() and is not compatible
with PR #74's identity map.

## Transformer-to-target field mapping

The seven output tables from PR #77 map to the PR #74 target schema:

| Transformer output | Target table / key |
|---|---|
| paper_user_identity_map.jsonl | paper_user_identity_map / supabase_user_id |
| paper_accounts.jsonl | paper_accounts / user_id |
| paper_equity_positions.jsonl | paper_equity_positions / (user_id, product, instrument_key) |
| paper_derivative_positions.jsonl | paper_derivative_positions / (user_id, instrument_key) |
| paper_orders.jsonl | paper_orders / order_id |
| paper_derivative_orders.jsonl | paper_derivative_orders / order_id |
| paper_watchlists.jsonl | paper_watchlists / (user_id, name) |

The emitted row fields are aligned with the columns in PR #74 migration 001. The transform
writes explicit internal UUIDs from the supplied mapping; the target's UUID default is not
used for migrated identities. Import ordering must create identity-map rows before dependent
account, position, order and watchlist rows.

## Validation gaps found and closed in PR #77

The first transformer revision could emit rows that violated target SQL constraints. It now
rejects:
- Uppercase order IDs/fingerprints (the SQL CHECK uses lowercase [a-f0-9]).
- Equity LIMIT orders without a positive limit_price_paise.
- Derivative position quantity above 1,000,000.
- Derivative position exchange values other than NSE or BSE when supplied.
- Position instrument keys outside the target's 1–100 character constraint.
- Invalid/non-calendar ISO expiry dates for derivative positions and orders.
- Derivative order lot counts above the source contract's 10,000-lot maximum.

Synthetic regression tests cover these cases. Existing paise, reservation, cost-basis,
simulation-only, product/status, order fingerprint, identity mapping and watchlist checks remain.

## Disposable PostgreSQL smoke-test evidence

The PR #74 branch's PostgreSQL 16 GitHub Actions smoke test Run #75 (45004575370) completed
successfully. Its log confirms migrations 001–005 and the existing 20261122083748 hardening
migration were applied in order to a disposable CI PostgreSQL instance. The workflow exercised
account initialization/idempotency, MARKET and LIMIT lifecycle behavior, long-option transaction
vectors, Firebase JWT identity-map RLS, server-only RPC grants, quote boundaries, concurrency
scenarios and expected schema/RPC registration. This is useful SQL parser/runtime smoke evidence
for that exact PR #74 branch, not proof of production readiness or a migration applied to the
linked Supabase project.

## Remaining unresolved checks

1. The PR #74 migrations and its PostgreSQL smoke workflow are still Draft; no claim is made
   that they have been merged, deployed or production-validated.
2. The linked Supabase project currently has zero public Paper Trading tables and only the
   existing 20261122083748 hardening migration. No live target snapshot can be reconciled yet.
3. Historical Firebase records have not been exported. Optional/missing fields and actual
   historical expiry encodings still need a real read-only export rehearsal.
4. PostgreSQL smoke tests are not a substitute for a Firebase-vs-SQL differential run against
   anonymized historical fixtures and full runtime/API authentication tests.
5. Importer, auth provisioning, rollback, dual-read/write freeze and production cutover remain
   out of scope. No SQL was applied and no data was imported by this audit.

## Safety record

- Read-only GitHub source review only.
- No Firebase export or Firestore write.
- No Supabase SQL execution, migration, table creation or data write.
- No PR was merged; PR #77 remains Draft.
