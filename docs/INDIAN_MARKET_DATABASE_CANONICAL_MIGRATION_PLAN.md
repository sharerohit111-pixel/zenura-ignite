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


## 11. Verified migration file manifest — 2026-11-24

This is a source-file inventory from the named PR/branch refs, not an executable migration plan. The hashes below are Git blob object IDs (40-character SHA-1), not SHA-256 digests. They identify the exact UTF-8 file blobs fetched during this audit. Re-fetch and compare branch heads before any future canonicalization because draft branches can move.

### 11.1 Production baseline and shared foundation files

Source ref: `integration/supabase-native-auth-professional-launch-2026-11-22` (PR #83 head). These are the original repository migration files observed on that ref.

| Version | File | Git blob SHA-1 |
|---|---|---|
| 20261122120654 | paper_trading_core_schema.sql | `a1e8abf468afc56e1193e3984b16ae21f558cc89` |
| 20261122120703 | paper_order_transactions.sql | `2094ef76782e3ef41b315a4d71b0e8ae5b2a7ccb` |
| 20261122120706 | paper_limit_order_transactions.sql | `091b0ac38076a44c310e7762f2584c21fc59cf68` |
| 20261122120710 | paper_account_initialization.sql | `53480363260dc877ce664642b2350dc4145754db` |
| 20261122120713 | paper_long_option_transaction.sql | `31b9254415cb0039e1aa65ed187528c6f8f362ea` |
| 20261122120716 | paper_trading_authenticated_rls_grants.sql | `9459c09a49e9fa0c481dcde3826082c9d1fba7bb` |
| 20261122120719 | professional_futures_investing_charts.sql | `e3913bb7c76b42e651d09c695cafab297dee10a0` |
| 20261122120722 | futures_market_order_transaction.sql | `49033ab42f658477e9695226dc429a2869b8975c` |
| 20261122120725 | upstox_oauth_stream_leases.sql | `0724abeecdbb25d35f8047d8de4add0d570d8b9f` |
| 20261122120800 | index_upstox_oauth_states_user_id.sql | `a28d080fb6adc26991d0a5d6153416aa2b6a6c93` |
| 20261122121443 | paper_market_worker_leases.sql | `26c972482b399041d85dfd3f18a1c9a85a154e9f` |
| 20261122122110 | paper_market_worker_leases.sql | `74128bc1ec64ff3e7d2fd53894daa36f861171b8` |
| 20261122123415 | paper_market_worker_lease_timeout.sql | `cfd9813854a0066006e7c122138efecc6643c02e` |
| 20261122124500 | retire_paper_investing.sql | `793de57474f487eadacbf14e0bfee209b8a80610` |
| 20261122131000 | equity_protective_order_atomic_fill.sql | `b28def6c74579193dbf3d94e503b02852a3861f4` |
| 20261122134500 | paper_protective_order_atomic_cancel.sql | `1514bde8830ef9182eedc07a14e94bf5805fff0b` |
| 20261122141000 | equity_protective_worker_scan_index.sql | `78734afff53a178a6a3e97f1cfde1df3d6d9b32b` |
| 20261122142500 | create_equity_protective_order_rpc.sql | `d7c1d8c741b394a5ea765263f8c2ad9253abffe3` |
| 20261122150000 | prevent_overlapping_equity_protective_exits.sql | `c4d161df30e7f0b494644c91569d3a747c0a217d` |
| 20261122153000 | reserve_equity_protective_exit_shares.sql | `8352f97311a9df4607af0c003d61ee2ecc7135ad` |
| 20261122214500 | align_option_charges_with_nse_ipft_schedule.sql | `722c3fe5f757209948c3327cf3e13f4d4d82276d` |
| 20261123023500 | paper_exchange_session_calendar.sql | `5834d0fed231dec26627bec0f844be736fbb8804` |
| 20261123040000 | paper_intraday_limit_reservations.sql | `e80308c61aa047703bf4fbcd709f44934c9dc83e` |
| 20261123043000 | intraday_limit_worker_lease_key.sql | `f4e43e6322f0b0f675b490d0a7f1c3da1b0efcb5` |
| 20261123050000 | nse_equity_market_atomic_charges.sql | `85ae5525519b240e086114ff17c3932ebaa94994` |
| 20261123060000 | nse_equity_limit_atomic_charges.sql | `260004aadd2740932521988f7bb029b588c8899e` |
| 20261123070000 | bse_equity_fee_master.sql | `469618465050ff8970c42426d1955f9eed4f4cfa` |
| 20261123080000 | bse_equity_fee_aware_order_settlement.sql | `c3bf619876872f40f48549b8b776ed2ac4791de2` |
| 20261123090000 | exchange_session_calendar_import.sql | `2dcc21ef68fd3b2ce6e22f7d75be77ee1f84cbf0` |
| 20261123091000 | require_verified_session_snapshot_for_intraday_limits.sql | `76c525c9f4c84d5b6d47860b11b792a92b7882da` |
| 20261123100000 | allow_long_option_orders_with_reserved_futures_margin.sql | `7e1839032d3873f09d020c2639f6994d0d30e9f1` |
| 20261123110000 | market_gateway_service_role_runtime_grants.sql | `861fc885495d8f855e4a861c8d935f8e45582a68` |
| 20261123120000 | make_derivative_expiry_cutoff_exclusive.sql | `73c661faeb6945b684ea1b90732a7fecfb9af509` |

### 11.2 Feature-branch migrations and collision registry

| Source PR / branch | Version | File | Git blob SHA-1 | Dependency / disposition |
|---|---|---|---|---|
| #87 `feature/indian-market-futures-limit-ledger` | 20261123140000 | futures_limit_ledger_foundation.sql | `f9f0979e960ad0966ff2b00f3b05634c8428d1c5` | Futures ledger foundation; timestamp collides with #92 Equity trigger |
| #92 `feature/indian-equity-lifecycle-audit-2026-11-23` | 20261123130000 | equity_append_only_fill_cash_ledgers.sql | `1e0794ab697a7db08043e614f4099e8180cbdd78` | Base for #100 integrity/atomic writers |
| #92 same ref | 20261123140000 | equity_order_audit_ledger_trigger.sql | `ccbbdc9d890b302e972b69a36c4983800543c624` | Do not combine as duplicate writer with #100 explicit wrappers |
| #92 same ref | 20261123141000 | cash_equity_market_fill_cash_ledger.sql | `e11b4aeec162389a56abe8bbe4cd8a5836755c5e` | Dependency branch MARKET ledger implementation; compare with #100 replacement path |
| #89 `feature/indian-market-futures-limit-atomic-fill` | 20261123160000 | futures_limit_atomic_submit_release.sql | `4b197771fed318708638c355340ac91316dcd107` | Futures submit/release; collides with #100 |
| #89 same ref | 20261123170000 | futures_limit_atomic_fill.sql | `89bfca39cc2e61876e6441f090f28e644529364a` | Futures fill; collides with #100 |
| #93 `feature/s-trade-nse-futures-worker-lease-2026-11-23` | 20261123180000 | futures_limit_worker_lease_key.sql | `6f4db8e63bee7020c65bdd543e11e5661c41e5a8` | Futures-only replacement; superseded by combined allowlist after callsite verification |
| #91 `feature/indian-market-options-limit-schema` | 20261123180000 | paper_option_limit_schema.sql | `944fe680f2431923b4eb6f7f50b9ebb243c38cf8` | Options schema; collides with #93 and #100 |
| #91 same ref | 20261123200000 | paper_option_limit_submit_release.sql | `31dd622783a29a31e293611ef414625da1307e83` | Requires Options schema |
| #91 same ref | 20261123210000 | paper_option_limit_atomic_fill.sql | `c7998579b2da70614991dc78c730b1d381e22c71` | Requires submit/release |
| #91 same ref | 20261123220000 | derivative_limit_worker_lease_keys.sql | `251154084b4ff2f67cf383c89ea9f0a073ebb1fb` | Combined worker-key allowlist; retain only after all worker callsites reviewed |
| #91 same ref | 20261123230000 | market_gateway_service_role_read_grants.sql | `1e46d7fbf816d55b4a8ace4fe63a086598e35810` | Duplicate grant source vs #83 runtime grants; reconcile |
| #93 and #119 | 20261123240000 | paper_market_worker_lease_renewal.sql | `e1fde57d0264f3ba97186a3400abe382ae845d32` | Exact same blob in both PRs; include once only |
| #98 `feature/nse-options-accounting-risk-2026-11-23` | 20261123250000 | harden_option_limit_expiry_calendar.sql | `37291b25c9902a1e783844f2c0dd7d2d0c4d2f0f` | After Options release RPC exists; fail-closed expected-guard patch |
| #100 `feature/nse-equity-accounting-engine-2026-11-23` | 20261123143000 | equity_ledger_integrity_hardening.sql | `510c711dd46890658df119fb2323b7a493c97e99` | After #92 ledger schema |
| #100 same ref | 20261123160000 | nse_equity_market_fill_cash_ledger_atomic.sql | `011079f9c4ca366bea6a76fc36ab9da16e801061` | Atomic MARKET ledger writer; collides with Futures submit/release |
| #100 same ref | 20261123170000 | nse_equity_limit_fill_cash_ledger_atomic.sql | `485b16b926226bb690ed486ab8b584be60146570` | Atomic LIMIT fill writer; collides with Futures fill |
| #100 same ref | 20261123180000 | nse_equity_limit_reservation_ledger_atomic.sql | `ad533662c7872154686a80d761073975cb5bf582` | Reservation writer; three-way timestamp collision |
| #98 / #119 current worker branch | 20261123240000 | paper_market_worker_lease_renewal.sql | `e1fde57d0264f3ba97186a3400abe382ae845d32` | Reconfirmed byte-identical Git blob; one canonical migration |

### 11.3 Manifest completeness and hashing caveats

- The table above records the migration files directly fetched and hashed from the listed refs. Git blob SHA-1 is a stable content-addressed identifier for the fetched Git blob; it is not a SHA-256 security digest. A future canonical release manifest should additionally calculate SHA-256 over the exact raw file bytes from a checked-out commit.
- PR #83 contains additional migration files listed in §11.1; PR #87, #89, #91, #92, #93, #98 and #100 contribute the feature migrations in §11.2. PR #99 itself changes gateway/docs and does not add a migration path in its changed-file list; its grant migration is inherited from the shared Options chain and is listed above.
- PR #119's branch head moved during this audit. The shared renewal migration blob was re-fetched and remains identical; revalidate all current PR heads before constructing the final executable chain.
- This manifest intentionally does not assign replacement timestamps or claim dependency-complete ordering. The timestamp collisions remain unresolved and block merging any combined migration directory.
- Rollback classification is not yet approved. Treat financial ledger, order lifecycle, and identity transformations as forward-repair/restore-required until each migration's data-loss and dependency behavior is tested in disposable PostgreSQL.
- SQL body dependency graph (objects read/written, RPC replacement targets, trigger ownership, grants) still requires automated parsing plus manual review. File/hash inventory alone is not a dependency proof.

### 11.4 Next safe gate

1. Re-fetch all PR head SHAs and changed migration files in one locked snapshot.
2. Compute SHA-256 from raw bytes for every SQL file; preserve the Git blob SHA-1 as a secondary locator.
3. Build a single manifest with source PR, source head SHA, path, both hashes, dependency edges, collision resolution, and rollback class.
4. Review exact grants against every worker/gateway callsite; protect financial ledger tables from UPDATE/DELETE and add database-enforced append-only controls where absent.
5. Build the full chain in a disposable PostgreSQL database and run every schema, RLS, accounting, race, idempotency and worker-fencing test.
6. No staging/production apply until a staging target is explicitly provisioned, rehearsed, and separately approved.
