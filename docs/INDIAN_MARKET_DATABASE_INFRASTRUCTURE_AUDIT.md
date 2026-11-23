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
- Six internal service tables have RLS enabled with no policies: `paper_margin_preview_limits`, `paper_market_stream_leases`, `paper_market_worker_state`, `upstox_connection_controls`, `upstox_connections`, and `upstox_oauth_states`. The Security Advisor reports these as informational `rls_enabled_no_policy` findings. Keep them policy-less only if client table grants remain absent and trusted service access is explicitly scoped.
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
