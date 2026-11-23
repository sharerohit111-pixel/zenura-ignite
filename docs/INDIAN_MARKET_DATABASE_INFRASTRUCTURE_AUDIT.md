# Indian Market Database Infrastructure — Audit Baseline

Date: 2026-11-23
Repository: `sharerohit111-pixel/zenura-ignite`
Supabase project: `atvbjibhunvzpmfagagm` (`zenura-paper-trading`, ap-south-1, PostgreSQL 17.12)
Working branch: `feature/indian-market-db-infrastructure-2026-11-23`

## Scope and safety

This audit covers only Indian-market Paper Trading database infrastructure. Crypto tables, migrations, RPCs, policies, indexes, and runtime files are explicitly out of scope. No production DDL, migration, grant, policy, data write, deployment, merge, or feature activation was performed.

The working branch was created from `feature/indian-equity-lifecycle-audit-2026-11-23` so it inherits the Equity ledger draft baseline. It is not based on `main`, because `main` does not contain the Supabase migration tree. The branch created earlier from `main` is not used for implementation.

## Production project baseline

The Supabase project is `ACTIVE_HEALTHY`, region `ap-south-1`, PostgreSQL `17.12.0.000`.

The remote migration history contains 15 entries and currently ends at:

- `20261122123415_paper_market_worker_lease_timeout`

The remote history does not include the later Indian-market migrations present on the audited feature branch, including the exchange-session calendar, Equity intraday LIMIT reservations, NSE/BSE fee work, derivative expiry cutoff, and Equity append-only ledger foundation. These are draft/repository changes, not production-applied changes.

Production tables observed in `public` include:

- Shared Paper Trading: `paper_accounts`, `paper_orders`, `paper_equity_positions`
- Derivatives: `paper_derivative_orders`, `paper_derivative_positions`, `paper_futures_orders`, `paper_futures_positions`
- Other Indian-market support: `paper_protective_orders`, `paper_margin_preview_limits`, `paper_market_stream_leases`, `paper_market_worker_state`
- User/chart features: `paper_watchlists`, `paper_chart_drawings`, `paper_chart_preferences`, `paper_chart_templates`
- Legacy investing objects remain in production: `paper_investing_accounts`, `paper_investing_orders`, `paper_investing_positions`

No production tables named `paper_equity_fills`, `paper_equity_cash_ledger`, `paper_futures_fills`, `paper_option_limit_orders`, or `paper_option_limit_fills` were found in the audited public schema. Therefore PR #92 and PR #91 must not be described as production schema.

## Existing draft PR and migration boundaries

- PR #83 is the large Draft Indian Market integration/release branch. It documents no production migration/deployment and includes a forward-only retirement migration for Paper Investing.
- PR #87–#89 form the Futures LIMIT schema/submit/fill chain. These remain Draft and are not applied to production.
- PR #90 is the Options LIMIT design.
- PR #91 adds dedicated NSE long-Options LIMIT orders/fills and atomic RPCs on its draft branch; it remains Draft and unapplied to production.
- PR #92 adds Equity fills and append-only cash-ledger schema foundation. Its own description explicitly says existing MARKET/LIMIT RPCs are not yet wired to insert the fill and ledger rows atomically.
- PR #93 is a separate Futures LIMIT worker lease allowlist compatibility change.
- PR #94 is an Equity order-engine audit document.

The PR #91 Options LIMIT chain and PR #92 Equity ledger branch diverge from the same integration baseline. They must be reconciled deliberately; do not assume one branch contains the other's migration. PR #93 is another follow-up dependency for derivative worker lease key compatibility.

## Verified schema/security observations

- All observed `paper_%` business tables have RLS enabled; none had FORCE ROW LEVEL SECURITY enabled.
- Six internal service tables have RLS enabled with no policies: `paper_margin_preview_limits`, `paper_market_stream_leases`, `paper_market_worker_state`, `upstox_connection_controls`, `upstox_connections`, and `upstox_oauth_states`. The Security Advisor reports these as informational `rls_enabled_no_policy` findings. A direct privilege check found no table SELECT/INSERT/UPDATE grants for `anon`, `authenticated`, or `service_role` on these six tables in the live project. The inspected `SECURITY DEFINER` RPCs execute as their owner (`postgres`); do not infer that the `service_role` has direct table access. The later draft runtime-grants migration in PR #91 is not in production migration history. Keep the no-client-grant boundary; separately verify which trusted gateway paths require explicit minimal `service_role` grants before any rollout.
- Owner-facing policies observed on user tables use `(select auth.uid()) = user_id`. UPDATE policies include both USING and WITH CHECK where present.
- The inspected transaction/worker RPCs are SECURITY DEFINER with explicit ACLs showing execution for `postgres` and `service_role`; the inspected set did not show anon/authenticated execute grants. Every SECURITY DEFINER function still needs a per-function body/search_path/authorization review before extending it.
- Order/position rows commonly reference `auth.users(id)`; positions use user-scoped composite primary keys. Existing order-to-fill relationships are not present in production because the fill tables are not deployed.
- Existing order receipts have per-user partial unique idempotency indexes and user/time history indexes. Pending-worker partial indexes exist for equity and Futures.
- Supabase Security Advisor reported 17 unused indexes at this early observation point. Do not drop them based on a zero/low-traffic sample; first validate query plans and workload, then remove only in a separately reviewed migration.

## High-priority gaps and design risks

1. **Migration drift / staging gap:** remote production history stops before the repository's later Indian-market migration sequence. There is no verified isolated staging database in the linked project history. Do not apply the draft chain to production as a shortcut.
2. **Ledger integration gap:** PR #92 creates append-only Equity fill/cash-ledger tables but explicitly does not connect existing order RPCs. A fill, position/cash mutation, order status update, reservation consumption, and ledger insert must commit in one database transaction.
3. **Cross-tenant relational integrity:** draft Equity fill and cash-ledger tables carry both `user_id` and `order_id`, but their order FK is only on `order_id`. Add/verify a composite unique key on orders and composite FK `(user_id, order_id)` so a row cannot claim one tenant while referencing another tenant's order. Apply the same review to all derivative fill/order relationships.
4. **Fill idempotency:** every fill must have a unique execution identity scoped to the order (e.g. UNIQUE(order_id, execution_id)); ledger events need stable tenant-scoped event keys. Exact retries must be no-ops; changed payloads must fail.
5. **Reservation conservation:** keep cash reservation, margin reservation, and close-quantity reservation distinct. Enforce nonnegative balances, reservation <= available/held amount, proportional release on partial fills, and zero reservation on terminal orders. Account → order/idempotency → position lock order is the established derivative write order.
6. **Market/asset separation:** Equity, Futures, and Options should retain distinct contract/position semantics. Futures positions can be signed; long Options positions remain positive quantity. Avoid a single polymorphic fill table unless its constraints can preserve all asset-specific invariants.
7. **RLS and RPC grants:** authenticated clients should receive owner-scoped reads only where required. Internal ledgers, worker leases, OAuth tokens, and reservations remain non-client writable. SECURITY DEFINER functions require empty/fixed search_path, explicit auth/service-role checks, and PUBLIC/anon/authenticated EXECUTE revocation before granting only the intended role.
8. **Production-only legacy Investing objects:** PR #83's retirement migration is not in remote migration history; do not assume those objects have been removed. Their retirement must remain a separate forward-only, dependency-checked migration and is outside this database-infrastructure audit's implementation scope unless explicitly approved.
9. **Index optimization:** retain unique idempotency and FK-supporting indexes; review history/worker partial indexes against actual query predicates. Unused-index advisor output is not sufficient evidence for deletion.
10. **Migration ordering/reversibility:** preserve the recorded remote migrations unchanged. New migrations must be forward-only additive where possible, each isolated by concern, idempotent only where safe, and have a tested down/rollback strategy for disposable environments. Production rollback should use a compensating migration, not edit migration history.

## Proposed migration/test sequence (design only)

1. Baseline guard: assert required parent tables, expected constraints, role grants, RLS state, and migration prerequisites. Fail closed on schema drift.
2. Ledger foundation: asset-specific immutable fills and append-only cash/margin ledger event tables with tenant-safe composite foreign keys and execution/event uniqueness.
3. Reservation model: separate order reservation records or strongly constrained reservation columns; define one source of truth and reconciliation queries.
4. Atomic settlement RPCs: update account, order, position, reservation, fill and ledger in one transaction using the documented lock order.
5. RLS/grants: owner-scoped SELECT only; revoke direct client writes to internal accounting tables; grant trusted service role only the minimal required privileges.
6. Indexes: add workload-backed history, pending worker, idempotency, FK and expiry indexes with EXPLAIN-based checks.
7. Regression suite: schema guard; migration-order smoke; cross-tenant FK rejection; anon/authenticated/service_role privilege matrix; RLS owner isolation; SECURITY DEFINER ACL/search_path checks; append-only mutation rejection; exact replay and changed-payload rejection; concurrent duplicate fill/cancel races; partial-fill reservation/cash/margin conservation; terminal reservation release; Crypto schema/migration non-interference assertions.

## Next implementation gate

Before any schema migration is authored, reconcile the PR #91, #92, and #93 migration chains against the production migration history and select a single integration base. No production migration or branch merge is authorized by this audit.


## Follow-up reconciliation — PR #91/#92/#93 (2026-11-23)

### Exact branch lineage

- PR #92 head: `feature/indian-equity-lifecycle-audit-2026-11-23` at `aea81ca8eed32e4b9c614eb39547ccf761f4d409`; base is the Supabase-native-auth integration branch. Its unique migration is `20261123130000_equity_append_only_fill_cash_ledgers.sql`.
- PR #91 head: `feature/indian-market-options-limit-schema` at `7a47bb29ff6ef2683a81f16cb01f70c37fdb473a`; base is `feature/indian-market-options-limit-design`. Its migration chain includes Futures LIMIT foundations/submit/fill/lease, then Options LIMIT schema/submit/fill/worker lease and runtime grants. PR body reports disposable PostgreSQL and market-gateway checks passed on implementation head `df89617...`; current head adds deployment/security documentation.
- PR #93 head: `feature/s-trade-nse-futures-worker-lease-2026-11-23` at `8100efdb459ebf3da8d56cad2520372cc184a2ff`; base is the Futures LIMIT atomic-fill branch. It adds a lease-key compatibility migration and its PR body says CI is pending.
- Futures chain #87 → #88 → #89 is a sequential dependency chain. #89 includes later hardening to the schema and atomic RPC foundation, not just a standalone fill file.

### Migration chain comparison

The Options LIMIT branch includes the earlier common production migration sequence through `20261123120000_make_derivative_expiry_cutoff_exclusive.sql`, then Futures migrations at 14:00/16:00/17:00/18:00 and Options migrations at 18:00/20:00/21:00/22:00/23:00. It does not include the separate Equity ledger migration at 13:00.

The Equity PR branch includes the common sequence and Equity ledger at 13:00, but not the Futures/Options LIMIT chain.

The PR #93 branch contains the Futures LIMIT chain and a dedicated `20261123180000_futures_limit_worker_lease_key.sql` migration. The Options branch instead has `20261123220000_derivative_limit_worker_lease_keys.sql`, which allows both Futures and Options keys. These are overlapping implementations of the shared lease function and must not both be applied blindly. Compare function bodies and tests; choose one final migration that preserves the equity delivery/intraday/protective keys plus both derivative keys.

### Newly verified schema-level risks (draft migrations only)

1. Equity draft `paper_equity_fills` has `UNIQUE(order_id, execution_id)`, but `order_id` references `paper_orders(order_id)` without tenant-scoped composite ownership. `user_id` is independently tied to `auth.users`, so the FK does not prove the referenced order belongs to that user.
2. Equity cash-ledger `order_id` and `fill_id` FKs are likewise single-column. A mismatched tenant/order/fill pair is not structurally excluded by those FKs.
3. Futures draft `paper_futures_fills` has no `user_id, order_id` composite FK. It has order/execution and order/sequence uniqueness, but no append-only trigger. It grants service_role UPDATE and DELETE, contrary to immutable audit-ledger intent.
4. Options LIMIT fills reference order_id only and do not carry their own user_id. The owner-scoped read policy derives ownership through the order, which is valid for reads, but the schema has no composite tenant FK if the table later gains tenant attribution.
5. Options fill rows are granted service_role SELECT/INSERT only; this is safer than the Futures fill grant but append-only trigger/immutability should still be explicit and tested.
6. Equity migration grants service_role SELECT/INSERT and installs append-only triggers. Its comment correctly states that existing Equity MARKET/LIMIT RPCs are not yet wired to insert fill/ledger rows atomically.
7. Futures fill migration updates positions/accounts/orders/fills atomically within its SECURITY DEFINER RPC and exact execution replay is checked before quote freshness. Preserve that behavior while adding relational hardening.
8. Options fill migration similarly locks account then order then position, performs replay validation, and updates fill/order/position/cash reservation state in one transaction. Preserve its established lock order and accounting semantics.

### Required integration decision

Do not cherry-pick PR #93 on top of the Options branch without resolving the lease migration overlap. Do not apply either branch's migrations to production. The canonical disposable integration branch should be assembled only after:
- selecting the Options branch as the current fullest derivative lifecycle candidate;
- porting the Equity ledger migration from PR #92 with tenant-safe composite keys;
- selecting exactly one derivative worker-lease migration (or authoring one final combined migration);
- checking that all parent unique keys exist before composite FKs are added;
- validating the exact ordered chain from the production migration-history boundary in a fresh disposable PostgreSQL database.

### Next database-only implementation unit

The next safe code change should be a draft-only additive migration design/implementation for tenant-safe parent unique keys and composite foreign keys across Equity/Futures/Options fills and ledger rows, plus Futures fill immutability. Before writing it, inspect every table's existing PK/unique keys and the full affected RPC bodies so no current insert contract is broken. This work must remain on `feature/indian-market-db-infrastructure-2026-11-23`; it must not modify Crypto files or production.


## Follow-up implementation — tenant/fill integrity draft (2026-11-23)

Draft artifacts committed on the infrastructure branch:

- `supabase/drafts/indian_market_tenant_fill_integrity.sql`
- `supabase/drafts/indian_market_tenant_fill_integrity.down.sql`
- `docs/INDIAN_MARKET_DATABASE_INTEGRITY_REGRESSION_TESTS.md`

These files are deliberately under `supabase/drafts/`, not `supabase/migrations/`. The current infrastructure branch contains the Equity ledger migration but does not contain the Futures LIMIT and Options LIMIT schema/fill migrations. The proposed SQL requires all three asset subsystems and intentionally fails if prerequisites are absent; it must not be applied or moved into the active migration chain until a canonical integration branch contains the complete parent/child tables in reviewed order.

### Draft contents

- Adds composite parent unique keys for Equity and Futures orders, plus a composite user/fill key for Equity fills.
- Adds tenant-consistent composite FKs for Equity fills → Equity orders, Equity cash-ledger → Equity orders/fills, and Futures fills → Futures orders.
- Keeps Options fill ownership normalized through its globally unique order_id primary-key parent; it does not add a redundant user_id column to the Options fill table.
- Adds append-only UPDATE/DELETE rejection triggers for Futures and Options LIMIT fills.
- Revokes UPDATE/DELETE from service_role on the Equity/Futures/Options fill and Equity ledger tables while retaining service_role SELECT/INSERT.
- Includes a rollback draft that restores the original Futures fill service_role DML grants; the Options fill baseline remains SELECT/INSERT only.
- Adds a regression contract for cross-tenant FK rejection, immutable audit rows, RPC replay behavior, RLS isolation, grants, migration preconditions, and Crypto non-interference.

### Review status and blockers

- The draft is source-reviewed against the Equity ledger DDL, Futures order/fill DDL, Options LIMIT order/fill DDL, and the inspected settlement RPC lock/replay paths.
- No disposable PostgreSQL integration test has been executed in this turn. The regression file is a test contract, not evidence of passing tests.
- The composite FKs use `NOT VALID` followed by explicit `VALIDATE CONSTRAINT`; historical orphan/mismatched rows therefore fail closed.
- The migration file intentionally has no explicit BEGIN/COMMIT wrappers; migration tooling controls transaction boundaries.
- The rollback is intended for disposable environments only and does not authorize production rollback.
- No active migration was added, no production SQL was executed, no Supabase migration was applied, and no Crypto file/object was modified.

### Branch-base correction

The infrastructure branch was created from the Equity lifecycle audit branch, not from the Options branch. Therefore it currently contains the Equity ledger but not the Futures/Options LIMIT migration chain. The Options branch remains a candidate integration source, not the current parent of this infrastructure branch. Do not infer that the complete three-asset schema is present on this branch.


### RPC contract verification and draft naming correction

A second source inspection confirmed:

- `paper_orders` already has globally unique `order_id` as its primary key and a non-null `user_id`; the proposed `(user_id, order_id)` unique key is therefore a valid composite FK target.
- The Futures LIMIT fill RPC inserts both `order_id` and the order-resolved `v_user_id` into `paper_futures_fills`, so the proposed composite ownership FK matches the current insert contract.
- Options LIMIT fills contain only `order_id`; their parent `paper_option_limit_orders` has globally unique `order_id` and `user_id`. Keeping ownership normalized through that parent is compatible with the existing RPC insert shape.
- Existing Equity fill/cash-ledger tables are not yet written by the inspected Equity MARKET/LIMIT RPCs. The Equity ledger migration itself documents this gap. Do not treat Equity ledger persistence as complete until a separate atomic integration change and tests are implemented.

The draft SQL files have been renamed to neutral filenames under `supabase/drafts/`. The initial timestamp matched the Futures LIMIT foundation migration's timestamp, which would create ambiguous migration ordering if copied into the active migration directory. No timestamped active migration was created.

This remains source-level contract review only; no PostgreSQL disposable test execution has been performed.


## NSE Equity atomic fill/ledger integration design (2026-11-23)

Created `docs/INDIAN_EQUITY_FILL_LEDGER_ATOMIC_INTEGRATION.md` after inspecting the complete current Equity schema and settlement RPC definitions on the Equity lifecycle branch.

Verified settlement functions:
- `execute_paper_market_order(...)` — final charges-aware definition is replaced by the later Equity LIMIT migration.
- `execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)`.
- `execute_paper_intraday_limit_fill(text,bigint,bigint,bigint,bigint)`.

The three functions currently settle full order quantity; they do not expose partial-fill execution IDs. The fill schema supports multiple execution IDs per order, but that alone does not mean partial fills are implemented. For the current contract, a deterministic order-scoped execution ID is required; any future partial-fill capability must first extend the worker/RPC contract with stable execution IDs and fill sequence.

The design specifies in-transaction fill insertion and matching cash-ledger entries using the final settlement variables, not a paper_orders trigger. LIMIT BUY requires two distinct ledger facts: TRADE_DEBIT for actual cash debit and RESERVATION_CONSUME for the reserved-cash release. Both snapshots must match the post-settlement account state. MARKET trades have no cash reservation consumption. LIMIT SELL share-reservation release remains represented by position/order state, because the current cash ledger does not model reserved share quantities.

Cancellation/rejection reservation-release ledger entries are explicitly out of scope for this fill-integration step and need a separate cancel/reject RPC integration review.

No settlement RPC was modified in this step. No active migration was created, no disposable PostgreSQL integration tests were run, and production/Crypto remain unchanged.
