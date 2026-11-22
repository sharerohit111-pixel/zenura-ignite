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
