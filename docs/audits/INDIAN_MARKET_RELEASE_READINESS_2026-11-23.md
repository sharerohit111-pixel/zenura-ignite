# Indian Market Integration & QA — Release Readiness Audit

**Audit date:** 2026-11-23  
**Scope:** Indian Market only — Equity, Futures, Options, Supabase backend, Upstox integration, integration QA and release readiness.  
**Excluded:** Crypto.  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Audit baseline:** PR #91 head `7a47bb29ff6ef2683a81f16cb01f70c37fdb473a`  
**PR:** https://github.com/sharerohit111-pixel/zenura-ignite/pull/91

## Safety and disposition

This report is documentation-only. No application source, SQL migration, feature flag, production database, PR merge, or deployment was changed. This audit branch was created from the exact PR #91 head so it does not overwrite another workstream.

**Release verdict: NOT RELEASE READY.** Do not merge or deploy until critical gates below are resolved and independently reviewed.

## Evidence snapshot

- PR #91 is open, draft, and unmerged; 45 commits and 21 changed files at the audit snapshot.
- PR #91 reports GitHub Actions run #1105 passed on implementation commit `df89617bd49e15ed64e02764ec25e7918ea60946`. The PR head subsequently changed only deployment/security documentation.
- The linked production Supabase project `zenura-paper-trading` is healthy, PostgreSQL 17.12, region `ap-south-1`.
- Production reports 15 applied migrations; the audited feature branch contains 43 migration files. The 28-migration difference requires an ordered drift/replay review, not an assumption that branch migrations are live.
- Live catalog query: 21 public tables, all 21 have RLS enabled.
- Live privilege probe returned false for all of the following service_role table privileges: SELECT on `upstox_connections`, `paper_market_worker_state`, `paper_orders`, `paper_protective_orders`, `paper_equity_positions`; UPDATE on `paper_market_worker_state`. The same probe returned false for anon/authenticated SELECT on `upstox_connections`.
- PR #91 includes draft least-privilege grant migration `20261123230000_market_gateway_service_role_read_grants.sql`; it is not applied to production.
- Production catalog does not contain `paper_option_limit_orders`, `paper_option_limit_fills`, `paper_futures_fills`, `paper_exchange_sessions`, or `paper_intraday_limit_orders`.
- No separate staging Supabase project was identified in PR #91.
- No PR #91 reviews or review threads were present at the audit snapshot.

## Findings register

| ID | Severity | Finding | File / evidence | Recommended fix |
|---|---|---|---|---|
| IM-01 | CRITICAL | No separate staging Supabase project; browser-to-gateway rehearsal remains a release gate. | PR #91 body; `market-gateway/DEPLOYMENT.md`; `market-gateway/STAGING-LIMIT-E2E.md` is an archived Firebase runbook. | Provision isolated staging with separate Supabase project, secrets, OAuth redirect, gateway and test users. Run migration replay and browser-to-gateway E2E there before production consideration. |
| IM-02 | CRITICAL | Live service_role runtime table privileges required by gateway/worker are absent. | Live `has_table_privilege` probes all false for required SELECT/UPDATE privileges. Draft migration: `supabase/migrations/20261123230000_market_gateway_service_role_read_grants.sql`. | Validate the least-privilege migration against disposable staging; assert service_role grants and anon/authenticated denials; only then prepare a separately approved production migration plan. Do not apply it during this audit. |
| IM-03 | HIGH | Production schema is behind the audited branch migration set. | Supabase reports 15 applied migrations; branch contains 43 migration files; derivative LIMIT and session tables absent in live catalog. | Generate ordered migration manifest and schema diff; replay all migrations on disposable PostgreSQL/Supabase staging; verify rollback/forward-only handling and data-preserving compatibility. |
| IM-04 | HIGH | F&O partial fill lot-size boundary requires stricter validation. | `market-gateway/lib/paper-option-limit-worker.js`; `market-gateway/lib/paper-futures-limit-worker.js`; `20261123210000_paper_option_limit_atomic_fill.sql`; `20261123170000_futures_limit_atomic_fill.sql`. Worker chooses fill quantity from executable depth; reviewed fill RPCs need explicit lot-multiple enforcement. | Enforce valid lot multiples in worker and database RPC; add regression cases where executable depth is not a lot multiple and verify no invalid partial fill is committed. Re-check whether partial fills smaller than a lot are contractually supported before deciding the exact rule. |
| IM-05 | HIGH | Staging browser-to-gateway E2E evidence is incomplete. | `market-gateway/STAGING-LIMIT-E2E.md` archived Firebase guide; PR #91 release gates. | Add current Supabase JWT → gateway → owner-scoped RPC/API E2E for Equity, Futures and Options, including OAuth, order submit/retry/cancel, fill and portfolio reconciliation. |
| IM-06 | HIGH | Market-data rights and compliance approval remain outstanding. | `market-gateway/MARKET-DATA-COMPLIANCE.md`; PR #91 release gates. | Obtain documented vendor/exchange permissions and compliance sign-off for intended real-time display/use before public activation. |
| IM-07 | MEDIUM | Stacked PR dependencies and shared gateway/database hotspots can conflict. | PRs #83, #86, #87, #88, #89, #90, #91; shared `market-gateway/supabase-server.js`, `lib/supabase-runtime.js`, `paper_market_worker_state`, shared account/position RPCs. | Preserve dependency order; compare each PR against its actual base; integrate shared files only through reviewed dependent PRs and run the full suite after each integration step. |
| IM-08 | MEDIUM | Options LIMIT browser workspace lacks a dedicated explicit regression test and syntax gate. | `markets/stocks/options-limit-workspace.js`; `markets/stocks/index.html`; `.github/workflows/indian-market-checks.yml`. | Add node syntax check and browser tests for disabled-by-default state, auth transitions, duplicate click/retry, unreadable local retry state, contract selection, cancellation and history rendering. |
| IM-09 | MEDIUM | CI PostgreSQL major version differs from production. | `.github/workflows/indian-market-checks.yml` uses PostgreSQL 16; production is PostgreSQL 17.12. | Run migration and critical SQL suites on PostgreSQL 17 in CI/staging in addition to the current matrix. |
| IM-10 | MEDIUM | Independent review has not been recorded on PR #91. | PR #91 has no review submissions or review threads at audit snapshot. | Require an independent reviewer for accounting, security, migration and release gates; retain review evidence. |
| IM-11 | MEDIUM | Migration set contains duplicate/similar service-role grant migration content. | `20261123110000_market_gateway_service_role_runtime_grants.sql` and `20261123230000_market_gateway_service_role_read_grants.sql`. | Reconcile the two migrations and keep a single clear forward-only grant source where safe; do not rewrite applied migration history. |
| IM-12 | LOW | Supabase advisors report informational unused-index findings. | Production Performance Advisor reported 17 unused-index informational findings. | Review against real workload and query plans; do not drop indexes solely from advisor output. |

## Positive controls observed

- RLS enabled on all 21 public tables in the live catalog.
- Live probe found no anon/authenticated SELECT privilege on `upstox_connections`.
- PR #91 documents owner-scoped authenticated access, service-role-only RPCs, idempotent submit/fill replay protection, and disabled-by-default Options LIMIT feature flags.
- Worker source uses distinct Futures and Options lease keys.
- Derivative LIMIT worker policy includes fresh executable-depth checks, tick validation and session-aware expiry.
- GitHub Actions run #1105 passed the implementation commit's reported PostgreSQL migration smoke and regression suite. This is CI evidence, not production/staging E2E evidence.

## Required release gates (ordered)

1. Create isolated Supabase staging and matching gateway environment.
2. Validate the least-privilege service_role grant migration and negative client-role assertions in staging.
3. Replay the complete ordered migration set on PostgreSQL 17 staging; produce a schema and migration drift report.
4. Resolve F&O fill lot-size semantics and add worker + SQL regression tests.
5. Run accounting conservation tests across Equity, Futures and Options: cash, reserved cash, reserved margin, position quantity, fees, realized/unrealized P&L and append-only fill ledger.
6. Run concurrency tests: duplicate idempotency key, changed fingerprint, simultaneous submit, fill/fill race, cancel/fill race, lease expiry/reacquisition and cross-user isolation.
7. Run OAuth/token tests: state replay, callback ownership, token encryption/refresh/expiry, per-user isolation and no token leakage in logs.
8. Run browser-to-gateway E2E on staging and verify quote freshness/session/calendar fail-closed behavior.
9. Obtain market-data rights/compliance approval and independent code/security review.
10. Produce a signed release checklist and rollback plan. Production migration, merge and deployment require explicit approval.

## Explicitly not done

- No production SQL or migration executed.
- No secrets, OAuth credentials, feature flags or production settings changed.
- No application code or other workstream branch overwritten.
- No PR merged, no deployment triggered, and no feature activated.
- Crypto intentionally excluded.
