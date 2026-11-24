# Indian Market Database — Canonical Migration Reconciliation Plan

Status: Draft / documentation-only coordination artifact  
Repository: `sharerohit111-pixel/zenura-ignite`  
Supabase project: `atvbjibhunvzpmfagagm`

## Safety contract

- This document does not apply, alter, or repair any production migration.
- Do not merge this PR, deploy, enable workers, or enable feature flags as part of this plan.
- Do not edit Crypto schemas, migrations, functions, policies, or data.
- Do not rewrite any migration already recorded in `supabase_migrations.schema_migrations`.
- All implementation validation must use a disposable PostgreSQL instance first. Staging is a later, separately approved rehearsal.
- Existing feature PRs remain owned by their respective chats; this document coordinates dependencies and does not supersede their code.

## 1. Production baseline observed

The production migration history was queried directly from `supabase_migrations.schema_migrations`. It contains 15 recorded versions, with the latest recorded version `20261122123415`. Preserve these records and their effects exactly.

Two historical rows have the same migration name `paper_market_worker_leases`:
- `20261122121443`: original shared lease migration.
- `20261122122110`: no-op migration (`SELECT 1`).

This is a duplicate-name/history anomaly, not evidence that two distinct lease implementations were applied. Do not delete either production history row or edit either applied migration. A forward-only follow-up may improve repository naming/documentation if required, but must not attempt to rename remote history.

## 2. Draft-chain version collisions

The following version prefixes are reused by distinct SQL files across active/draft branches. They cannot all be combined in one ordered migration directory under their current names.

| Version prefix | Competing content / owner |
|---|---|
| `20261123140000` | Futures LIMIT ledger foundation (Options/Futures chain); Equity audit-ledger trigger (Equity accounting chain) |
| `20261123160000` | Futures LIMIT atomic submit/release; Equity MARKET atomic fill/cash ledger |
| `20261123170000` | Futures LIMIT atomic fill; Equity LIMIT fill/cash ledger |
| `20261123180000` | Options LIMIT schema; Futures-only worker lease-key migration; Equity LIMIT reservation migration |

Other duplication / sequencing findings verified against current PR heads:
- PR #99's `20261123110000_market_gateway_service_role_runtime_grants.sql` and `20261123230000_market_gateway_service_role_read_grants.sql` have identical grant statements in the inspected SQL. Retain one canonical grant source only after the final callsite-derived privilege list is approved.
- PR #93 and PR #119 both contain `20261123240000_paper_market_worker_lease_renewal.sql`; their Git blob SHA is identical (`e1fde57d0264f3ba97186a3400abe382ae845d32`). Include this migration exactly once in the canonical chain.
- PR #99's `20261123220000_derivative_limit_worker_lease_keys.sql` contains the combined allowlist for Equity Delivery LIMIT, Protective, Intraday LIMIT, Futures LIMIT and Options LIMIT. PR #93's separate Futures-only key migration overlaps that shared RPC replacement and should not also be installed as an independent function definition. Preserve the combined allowlist after validating all worker callsites.
- PR #98 adds the unique later migration `20261123250000_harden_option_limit_expiry_calendar.sql`. It patches `_release_paper_option_limit_order(text,text)` only if the expected old guard exists, and fails closed otherwise. It must follow the Options LIMIT release function migration and remain after the shared lease migration in the proposed ordering.
- PR #92's deferred Equity audit-ledger trigger must not coexist as a second accounting writer with PR #100's explicit atomic accounting path for the same execution events.

No version renumbering is performed by this PR. Assign final unique timestamps only after exact SQL dependency review and a single disposable full-chain run.

## 3. Cross-chat dependency inventory

| Area | PRs / known work | Database ownership and dependency |
|---|---|---|
| Indian Market foundation | #70, #71, #83 | Existing account/order/position tables, RLS, common market infrastructure |
| Identity/security | #74 and related identity PRs | Firebase JWT subject must resolve through a stable identity map; do not cast Firebase UID to `auth.uid()` UUID |
| Equity order engine | #94, #102, #111 | Existing equity order receipts, intraday reservations, atomic MARKET/LIMIT RPC contracts |
| Equity accounting | #92, #100 | Append-only fill/cash ledgers, reservation accounting, ownership constraints; PR #100 atomic path supersedes duplicate deferred trigger |
| Futures order engine | #88, #89, #93, #114 | Futures LIMIT reservation/fill lifecycle, signed positions, margin accounting, derivative worker lease |
| Futures risk/accounting | #106, #108, #110, #112 | Shared account/margin boundary; MTM/expiry ledger remains separately designed and must not be assumed implemented by simulation helpers |
| Options order engine | #90, #91, #97, #113 | Separate long-only Options positions, LIMIT orders/fills, CE/PE contract constraints, worker cursor safety |
| Options accounting | #91 and Chat 6 | Premium reservation, close-quantity reservation, partial-close basis and fee conservation |
| Backend gateway/workers | #99, #102 | Authenticated API/RPC contract, worker lease, retry and service-role boundary |
| Upstox security | #115 | OAuth token storage and provider boundary; no broker secret or token data belongs in migration fixtures |

PR #94 explicitly states partial fills are not implemented in the equity order route. PR #89 carries the Futures LIMIT atomic partial-fill lifecycle. PR #91/Options LIMIT and PR #113 must be treated according to their actual SQL/CI state, not inferred from PR titles. PR #108 is simulation-only and has no SQL migration.

## 4. Canonical logical dependency order

This is the required logical order, not yet a timestamped executable chain:

1. **Immutable production baseline** — retain all 15 production-applied migrations unchanged.
2. **Identity foundation** — establish Firebase subject ↔ internal UUID mapping and trusted identity resolution. Reconcile existing `auth.users(id)` foreign keys before claiming Firebase compatibility.
3. **Shared security foundation** — RLS policy helpers, tenant predicates, function ownership, explicit `SECURITY DEFINER` search paths, and narrow grants.
4. **Existing shared market prerequisites** — session calendar, verified-session checks, fee masters, and current common account/order dependencies.
5. **Equity accounting** — append-only fill/cash ledger foundation; atomic MARKET/LIMIT writers; reservation/release; reversal invariants; execution idempotency.
6. **Futures accounting and LIMIT lifecycle** — Futures ledger; atomic submit/release; atomic fill; position/margin conservation. Preserve signed Futures positions.
7. **Options LIMIT lifecycle** — separate Options LIMIT schema; premium/close-quantity reservation; atomic fills and partial-close basis conservation. Preserve long-only positive Options positions.
8. **Shared worker lease extension** — one shared lease schema/RPC contract with explicit per-family allowlist keys. Lease fencing is not a substitute for account → order/idempotency → position locking.
9. **Final hardening** — constraints, FK ownership, unique execution identities, RLS/tenant tests, grants, rollback tests and full-chain PostgreSQL test.

### Schema separation rules

- Keep Equity, Futures, and Options positions in their own tables and domain-specific accounting semantics.
- Share account identity/cash/margin only through explicit, transactionally enforced contracts.
- Every ledger fill must prove that its order belongs to the same tenant/user. Prefer composite foreign keys where supported by the actual parent key design.
- Execution identities must be unique and stable under provider replay, worker retry, and partial fills. Define uniqueness at the correct scope (for example order + execution ID and order + fill sequence) and test collisions across tenants.
- Append-only financial ledgers must not grant UPDATE/DELETE to application or worker roles. Corrections must use linked reversal events.
- Keep Futures signed quantity and margin accounting distinct from long-only Options positive quantity and premium accounting.

## 5. Shared worker lease reconciliation

Candidate worker key families found across the drafts:
- Equity LIMIT: `paper_limit_orders`
- Equity protective: `paper_protective_orders`
- Equity Intraday LIMIT: `paper_intraday_limit_orders`
- Futures LIMIT: `paper_futures_limit_orders`
- Options LIMIT: `paper_option_limit_orders`

The canonical shared lease contract must:
- use one namespace/table and one allowlisted acquire/renew/release RPC family;
- bind lease ownership to an unguessable owner token;
- fence renew/release/cursor writes against stale owners;
- support expiry takeover and concurrent-claim serialization;
- keep cursors isolated by worker family;
- preserve the existing order transaction lock order: account → order/idempotency → position/reservation.

Before selecting one branch's migration, diff the combined derivative allowlist against every worker and RPC callsite. The Futures-only migration must not silently drop Options keys or vice versa.

## 6. Production security observations — open verification items

A read-only production catalog audit observed:
- RLS enabled on the 21 inspected Indian Market public tables.
- Six internal tables have no client policies; their current client-role table grants were not present in the inspected grant checks.
- 19 SECURITY DEFINER functions were found. A follow-up read-only catalog query verified 18 have explicit `search_path = ''` and one explicitly uses `search_path = pg_catalog`. The earlier statement that 18 lacked a function-level setting was incorrect and is superseded by this catalog result. Empty search_path is a useful hardening baseline, but function bodies still require schema-qualification review.
- Inspected user-facing tables generally granted authenticated SELECT; `paper_watchlists` had authenticated CRUD. Internal worker and Upstox tables were not directly granted to authenticated.
- Service-role direct table privileges were absent on sampled tables, while service-role execution grants exist for selected RPCs. Validate the real gateway's required table/RPC access before changing grants.

Required security verification:
1. Enumerate every Indian Market SECURITY DEFINER function and set a safe explicit search_path (normally `pg_catalog` plus schema-qualified object references; add only necessary schemas).
2. Verify function owner and EXECUTE ACL; revoke PUBLIC/anon/authenticated where not needed.
3. Verify authenticated policies derive tenant identity from verified JWT claims/identity map, never client-supplied user IDs.
4. Test cross-tenant SELECT/INSERT/UPDATE/DELETE and RPC attempts.
5. Grant service_role only the exact table privileges needed by deployed workers/gateway; do not assume service_role bypasses all ordinary table ACL checks in every execution context.
6. Confirm no anonymous direct write grants and no mutable ledger grants.
7. Preserve explicit Crypto exclusion in all catalog queries, SQL fixtures, migration globs and test cleanup.

## 7. Mandatory validation gates

### A. Migration inventory and deterministic ordering
- Enumerate every `supabase/migrations/*.sql` file from each participating PR head.
- Detect duplicate numeric prefixes and duplicate migration names.
- Build a dependency graph from referenced tables, columns, functions, types, triggers and policies.
- Produce one sorted manifest with unique versions and SHA-256/blob hashes.
- Fail on unresolved dependency or unreviewed SQL drift.

### B. Disposable PostgreSQL full-chain test
- Start from an empty disposable PostgreSQL/Supabase-compatible database.
- Apply the complete canonical chain in order with strict error handling.
- Re-run migration smoke tests and all schema guards.
- Compare resulting catalog (tables, columns, indexes, constraints, policies, functions, grants) against expected snapshots.
- Seed two tenants and exercise cross-tenant isolation.
- Replay identical and conflicting execution identities.
- Race concurrent submit/fill/cancel/release and worker lease takeover.
- Verify ledger conservation, reversal constraints and append-only behavior.

### C. Rollback tests
- For every new migration, document whether rollback is supported.
- Test rollback only in disposable databases; production rollback is not authorized.
- For irreversible data transformations, require a forward repair/recovery migration and explicit backup/restore plan rather than a misleading down migration.
- Verify rollback leaves no orphaned functions, grants, policies, indexes or triggers.

### D. Staging rehearsal
- Only after all above gates pass, prepare a staged migration plan with exact versions, hashes, expected locks/duration, backup/restore checkpoint, post-migration smoke tests, abort criteria and owner sign-off.
- Staging apply requires separate explicit approval.
- Production apply requires a separate explicit approval and is outside this PR.

## 8. Current blockers / decisions required

1. Firebase identity mapping and the existing `auth.users(id)` FK assumptions are not yet reconciled.
2. Four migration-version collisions listed above must be resolved without editing applied production history.
3. PR #92's trigger path must not coexist with PR #100's explicit atomic ledger writers.
4. PR #100 needs fresh successful CI on its current head before its SQL is accepted as canonical.
5. Futures fill ownership and immutable-ledger grants require hardening.
6. Shared worker allowlists and lease migrations need one verified combined source.
7. Review all 19 SECURITY DEFINER function bodies for schema-qualified object references and effective execution safety; catalog settings are 18 empty search paths and one `pg_catalog` path, not 18 missing settings.
8. Exact gateway/worker service-role grant needs must be derived from callsites, not guessed.
9. A complete empty-database migration run, rollback suite, and tenant isolation suite are still required.

## 9. Explicit non-actions

No migration was applied to production or staging. No PR was merged. No existing applied migration was edited. No Crypto schema was queried for modification or changed. No worker, broker route, or feature flag was activated.

---
This plan is a coordination baseline only. It must be updated from exact current PR heads and SQL diffs before implementation is authorized.


## 10. Chat 7 follow-up verification — 2026-11-24

This addendum records exact current PR-head observations after the initial plan was drafted. It does not authorize a merge, migration, deployment, or runtime activation.

### Additional cross-chat PR state

| PR | Current head / scope | Verified status |
|---|---|---|
| #93 | Futures LIMIT worker lease + heartbeat | Draft; contains Futures-only key migration and shared renewal migration |
| #98 | Options LIMIT expiry-calendar hardening | Draft; migration `20261123250000_harden_option_limit_expiry_calendar.sql`; CI run #1135 succeeded on inspected head |
| #100 | Equity ledger integrity hardening + atomic MARKET/LIMIT/reservation migrations | Draft; no workflow run found for inspected head SHA `fa3343de498d1522bad3871bd8d9f7cb8ece5299`; not CI-verified at this head |
| #117 | Options accounting race fixture isolation | Draft; test-only changes, no migration file |
| #119 | Options LIMIT worker heartbeat integration | Draft; exact-head workflow run #1302 was still in progress when inspected; do not mark full regression as passed |

### Updated collision and duplicate registry

1. `20261123140000`: Futures ledger foundation vs Equity audit-ledger trigger.
2. `20261123160000`: Futures atomic submit/release vs Equity MARKET atomic fill/cash ledger.
3. `20261123170000`: Futures atomic fill vs Equity LIMIT fill/cash ledger.
4. `20261123180000`: Options LIMIT schema vs Futures-only worker lease-key migration vs Equity LIMIT reservation migration.
5. `20261123240000_paper_market_worker_lease_renewal.sql`: duplicated across PR #93 and PR #119 with identical blob SHA; include one copy only.
6. `20261123220000_derivative_limit_worker_lease_keys.sql`: combined lease-key function replacement. Prefer this single allowlist source over also applying the Futures-only duplicate function replacement from PR #93.
7. `20261123250000_harden_option_limit_expiry_calendar.sql`: unique Options expiry guard hardening; sequence after the Options release function exists.
8. PR #99's two service-role grant migrations repeat the same SELECT/UPDATE statements. Consolidate after callsite review; do not infer that identical SQL necessarily covers every current worker.

### Revised logical dependency notes

- Keep the immutable production baseline (15 applied rows; latest `20261122123415`) unchanged.
- Resolve the three-way `20261123180000` collision by assigning unique new versions to the three independent migrations after dependency analysis. Do not edit the already-applied production history.
- Place the shared combined lease-key migration once, after the worker-state table and before worker heartbeat/renewal consumers.
- Place the single shared renewal migration once, after the lease acquire/release RPC contract.
- Place Options expiry hardening after `_release_paper_option_limit_order(text,text)` exists.
- PR #98's successful CI is evidence for its own tested branch chain, not proof that the eventual cross-chat canonical chain is green.
- PR #119's in-progress run and PR #100's absent exact-head run remain validation blockers.

### Security catalog correction

The current production catalog result is:
- 19 SECURITY DEFINER functions total.
- 18 with explicit empty function-level search_path.
- 1 with explicit `pg_catalog` search_path.

This corrects the earlier draft's inaccurate count of functions missing an explicit setting. Continue to inspect function bodies for schema-qualified references, owner, EXECUTE ACL and unintended PUBLIC/anon/authenticated execution.

### Remaining high-priority implementation blockers

1. Reconcile Firebase identity resolution with Supabase-native Auth and existing `auth.users(id)` foreign keys before claiming a supported identity path.
2. Complete a single deterministic migration manifest with version, file path, Git blob SHA-256/content digest, source PR, dependency and rollback classification.
3. Harden Futures fills as append-only and ensure composite user/order ownership FKs are present in the canonical chain.
4. Derive exact service_role grants from all current gateway and worker callsites; specifically include required Futures worker reads only after review, and remove unnecessary UPDATE/DELETE from financial ledgers.
5. Run the complete combined migration chain from an empty disposable PostgreSQL database, then tenant-isolation, replay, race and ledger-conservation tests.
6. Keep staging unavailable/unverified until a separate Supabase staging project or branch is provisioned and inspected. No production or staging SQL has been applied by this addendum.
7. No Crypto schema, migration, function, policy or data was changed.
