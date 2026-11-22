# Isolated Supabase Role/RLS CI Harness

## What was added

- `.github/workflows/audit-supabase-role-rls-security.yml` is a manual (`workflow_dispatch`) audit-only workflow.
- It checks out this isolated audit branch, then checks out the current draft source branch for PR #70 read-only.
- It applies the five draft migrations to a disposable PostgreSQL 16 service container only.
- `scripts/ci/supabase-role-rls-security.sql` checks service-role-only RPC execution, absence of PUBLIC/anon/authenticated RPC execution, RLS enabled on all 13 draft tables, server-owned table write grants, authenticated read grants, and owner-scoped account/watchlist behavior.

## How to run

In GitHub Actions, select **Audit — Supabase role and RLS security checks** and run it on branch `audit/firebase-supabase-compatibility-2026-11-22`. The workflow has no Supabase secrets and does not connect to Firebase or any Supabase project.

## Signature verification

Before committing the harness, each of the six RPC signatures asserted by the SQL test was compared with the exact function declarations and grants in PR #70 draft migrations 002–005. The checked signatures are: account initialization, market order, limit submit/fill/cancel, and long-option order. The harness reads the draft branch as a source checkout; it does not alter that branch.

## Evidence status

The workflow and SQL assertion files were committed and fetched back from GitHub for content verification. The workflow has **not yet been dispatched**, so no pass/fail result is claimed. A GitHub Actions run is still required to validate the SQL assertions against the disposable PostgreSQL 16 service.

## Known limits

This first security harness tests the role/ACL boundary, RLS enablement, account read isolation and watchlist owner checks. It does not yet prove cross-user isolation for every individual read table, nor does it test concurrent transaction races, Firebase parity, or the trusted HTTP adapter's Firebase-token-to-Supabase-UUID mapping. Those remain separate follow-up stages.

No PR #70 SQL or workflow was edited. No PR was created or merged. No production database or Firebase resource was changed.
