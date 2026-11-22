# Isolated Supabase Role/RLS CI Harness

## What was added

- `.github/workflows/audit-supabase-role-rls-security.yml` is a manual (`workflow_dispatch`) audit-only workflow.
- It checks out this isolated audit branch, then checks out the current draft source branch for PR #70 read-only.
- It applies the five draft migrations to a disposable PostgreSQL 16 service container only.
- `scripts/ci/supabase-role-rls-security.sql` checks service-role-only RPC execution, absence of PUBLIC/anon/authenticated RPC execution, RLS enabled on all 13 draft tables, server-owned table write grants, authenticated SELECT grants and owner-scoped SELECT policies across all six user-readable tables, plus runtime two-user account/watchlist isolation. Watchlist runtime checks cover cross-user insert/update/delete denial and own-row update/delete; the second user's row is seeded by the harness administrator.

## How to run

In GitHub Actions, select **Audit — Supabase role and RLS security checks** and run it on branch `audit/firebase-supabase-compatibility-2026-11-22`. The workflow has no Supabase secrets and does not connect to Firebase or any Supabase project.

## Signature verification

Before committing the harness, each of the six RPC signatures asserted by the SQL test was compared with the exact function declarations and grants in PR #70 draft migrations 002–005. The checked signatures are: account initialization, market order, limit submit/fill/cancel, and long-option order. The harness reads the draft branch as a source checkout; it does not alter that branch.

## Evidence status

The workflow and SQL assertion files were committed and fetched back from GitHub for content verification. The workflow has **not yet been dispatched**, so no pass/fail result is claimed. A GitHub Actions run is still required to validate the SQL assertions against the disposable PostgreSQL 16 service.

## Known limits

This first security harness tests the role/ACL boundary, RLS enablement, account read isolation and watchlist CRUD ownership. All six authenticated read surfaces now have two-user runtime read-isolation assertions using synthetic fixtures. The write-operation tests beyond Watchlist are still not applicable to client roles because direct trading writes are intentionally revoked. It also does not test concurrent transaction races, Firebase parity, or the trusted HTTP adapter's Firebase-token-to-Supabase-UUID mapping. Those remain separate follow-up stages.

No PR #70 SQL or workflow was edited. No PR was created or merged. No production database or Firebase resource was changed.


## Concurrent MARKET order / idempotency harness

- `scripts/ci/supabase-market-order-concurrency.sh` creates a third synthetic auth user and initializes its account in the disposable PostgreSQL database.
- Two independent `psql` sessions submit the same MARKET BUY concurrently with the same idempotency UUID and request fingerprint.
- Assertions require exactly one persisted order and exactly one 10,000-paise cash debit.
- A subsequent request reusing that idempotency UUID with a different fingerprint must fail.
- The workflow runs this after the role/RLS assertions, against the same disposable PostgreSQL service. It does not contact Firebase, Supabase production, Upstox, or any external API.
- This is a targeted two-session race check, not a high-volume load/stress benchmark. It has been authored but not executed yet.


### Additional concurrent cash-reservation race

The same isolated script also races two distinct 60,000,000-paise MARKET BUY requests against the synthetic account. Since the starting balance is 100,000,000 paise and the earlier idempotent test has already spent 10,000 paise, exactly one large order may succeed. The test asserts one successful order and one corresponding debit; both succeeding or both failing is treated as a failure. This is a two-session targeted race check, not a load benchmark. Shell syntax was checked locally with `bash -n`; the PostgreSQL assertions remain pending GitHub Actions execution.


### RPC execution role

The concurrency script now issues each MARKET RPC call after `SET ROLE service_role`, including the mismatched-fingerprint rejection check. The harness reads assertions as the disposable database owner, but order mutations execute under the intended backend role rather than relying on PostgreSQL superuser privileges. This still does not replace a real Supabase staging integration test.


### Source-migration signature cross-check (2026-11-22)

The concurrency harness MARKET RPC call was cross-checked against PR #70 draft migration `202611220002_paper_order_transactions.sql`. The declared 13-argument order matches the harness: user UUID, order ID, idempotency UUID, request fingerprint, instrument key, trading symbol, exchange, side, product, quantity, execution price paise, quote timestamp milliseconds, and quote age milliseconds. The migration requires a 64-character lowercase-hex order ID and request fingerprint, a positive execution price, and quote age from 0 through 15,000 ms; the synthetic fixtures meet those checks. The initializer is the one-UUID `initialize_paper_trading_account(uuid)` RPC and provisions the disposable test account with ₹10,00,000 in virtual cash.

This is a source review only. The SQL and shell harness have not yet been executed by the workflow, so runtime compatibility remains unverified.


### SECURITY DEFINER hardening assertion

The role/RLS SQL assertions also verify that each of the six exposed RPCs is declared `SECURITY DEFINER` and has the pinned `search_path=pg_catalog, public` configuration. This guards against accidentally widening the callable surface or resolving attacker-controlled objects through an unsafe function search path. This assertion is source-reviewed but still awaits the isolated PostgreSQL workflow run.

### Synthetic RLS fixture column/constraint cross-check — 2026-11-22

Rechecked the role/RLS harness INSERT fixtures against the exact PR #70 draft table definitions for `paper_equity_positions`, `paper_derivative_positions`, `paper_orders`, and `paper_derivative_orders`.

- Equity-position fixture supplies all non-null columns; `trading_symbol`, `exchange`, and `reserved_quantity` are nullable/defaulted as expected.
- Derivative-position fixture supplies all non-null columns; contract metadata columns are nullable in the base schema.
- Cash-order fixture supplies every non-null column and satisfies the 64-character order/fingerprint checks plus MARKET/DELIVERY status constraints.
- Derivative-order fixture supplies every non-null column, including quote age, gross amount, and cash delta; order type/status and charge fields have valid defaults.
- The minimal `auth.users(id)` harness table satisfies the migration's declared user foreign-key dependency; no additional auth.users columns are referenced by the reviewed migration diff.

This is a static source cross-check only. The isolated GitHub Actions workflow has still not been dispatched, so PostgreSQL parsing, role behavior, RLS runtime assertions, and concurrency results remain unverified.
