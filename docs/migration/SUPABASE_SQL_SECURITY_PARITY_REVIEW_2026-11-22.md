# Supabase Migration SQL Security & Parity Review

**Review date:** 2026-11-22  
**Scope:** Read-only review of draft PR #70, migrations 001–005, and its PostgreSQL smoke-test workflow.  
**Review branch:** audit/firebase-supabase-compatibility-2026-11-22  
**Reviewed PR head:** f58479985d4efefcf0f5295d67111f505fb7c470

## Safety boundary

This review did not apply SQL to Supabase, change Firebase, edit PR #70, or modify PR #28. All observations are static review or GitHub Actions results. No live cutover is authorized.

## CI result — positive, limited evidence

GitHub Actions workflow run **44990636529** (“Paper Trading Supabase SQL smoke test”) completed with conclusion **success**. Its job completed all listed steps:
- Created disposable PostgreSQL 16 and minimal Supabase-compatible auth roles/schema.
- Applied migrations 001–005 in filename order.
- Exercised account initialization/read isolation.
- Exercised MARKET idempotency and LIMIT reserve/cancel/fill paths.
- Exercised long CE/PE order transactions.
- Verified expected table and RPC registration.

This establishes that the draft migrations parsed and executed in that disposable PostgreSQL harness and that the included scripted examples completed. It is not a Supabase project test, production-readiness result, full RLS test, race/concurrency test, or Firebase differential test.

## Findings requiring follow-up

### F-01 — CI does not currently prove RPC grants are service-role-only

**Severity:** Medium (test-coverage gap; no direct evidence of a production permission bypass)

The workflow runs SET ROLE service_role only for the account-initialization step, then resets the role. The following MARKET/LIMIT and option transaction test step opens a new psql process using the configured postgres superuser and invokes the RPCs without SET ROLE service_role. A superuser can execute functions regardless of ordinary EXECUTE grants, so the successful transaction tests do not verify the intended service-role-only boundary.

**Required validation:** In the disposable harness, explicitly test:
1. service_role can execute each RPC.
2. authenticated and anon cannot execute any trading/worker RPC.
3. Authenticated users can read only their own RLS-protected rows.
4. Authenticated users cannot directly write accounts, positions, orders, identity mappings, OAuth state, encrypted connections, leases, worker state, or rate-limit state.

The SQL currently contains explicit REVOKE ... FROM public, anon, authenticated and GRANT EXECUTE ... TO service_role statements for the reviewed trading functions. This is a positive static finding, but the current workflow does not adequately exercise the negative/positive role boundary.

### F-02 — RPC caller identity remains a trusted-backend responsibility

**Severity:** High if the future adapter trusts browser-supplied user IDs; controlled by the intended architecture if implemented correctly.

The trading and account-provisioning RPC signatures accept p_user_id. They do not derive the actor from auth.uid(). The functions are granted only to service_role, which is appropriate only if the service-role credential remains exclusively server-side and the API adapter derives the Supabase UUID from a verified authenticated session / trusted Firebase UID mapping.

**Required validation before any runtime connection:** Implement the Firebase UID → Supabase Auth UUID mapping in a trusted server process; verify the Firebase ID token server-side; never accept a browser-provided p_user_id as authority; never expose service-role credentials to browser code. Add negative integration tests for cross-user identity substitution.

### F-03 — Provider quote and instrument provenance are outside the SQL trust boundary

**Severity:** High if the RPC is callable from an untrusted path; otherwise an explicit backend contract.

The SQL validates several supplied price/timestamp fields and age limits, but it cannot independently establish that the instrument metadata and quote came from the authenticated Upstox feed or official instrument master. The caller supplies the instrument key, exchange/contract fields, execution price and timestamps. The migration comments correctly describe these as trusted-backend inputs.

**Required validation:** The server adapter must obtain the quote itself, validate instrument-key equality, provider provenance, timestamp freshness/future-time rejection, official lot/tick/expiry metadata and request fingerprint before calling the RPC. Add tests proving the browser cannot invoke the RPC or inject a fill price.

### F-04 — Direct watchlist writes have only coarse database validation

**Severity:** Low / hardening.

Authenticated users have direct INSERT/UPDATE/DELETE grants and owner-scoped RLS for paper_watchlists. The table currently enforces the allowed watchlist names and a maximum array cardinality of 50, but the database constraint does not reject duplicate instrument keys or enforce a per-key format/length. This is user-owned data, not an account-balance write, but malformed or duplicated entries may diverge from the existing gateway normalizer.

**Required validation:** Either route writes through the trusted adapter using the existing watchlist normalizer, or add database-side duplicate and instrument-key validation while preserving the existing supported symbol format and cap.

## Additional static observations

- The core schema enables RLS on all 13 tables and grants authenticated users SELECT on user-scoped account/position/order/watchlist data, plus direct CRUD only on their own watchlists.
- Sensitive identity, trading-write, OAuth, connection, stream lease, worker and margin-limit tables have no authenticated/anon grants in migration 001.
- MARKET, LIMIT and CE/PE transaction functions use SECURITY DEFINER with a fixed search_path and explicit service_role grants/revokes in the reviewed migration files.
- LIMIT submit/fill/cancel functions use account-first locking and re-read the order after acquiring the account lock, which is the intended serialization pattern. Real concurrent fill/cancel/retry testing is still required.
- Migration 005 accepts strike price as an RPC input but the current derivative order schema does not persist a strike-price column. The draft design already flags this as an audit/history decision; resolve it before any staging application if the existing Firebase order history stores strike.
- No evidence from this review authorizes applying migrations to the connected Supabase project. Keep Firebase as the live source of truth.

## Next required stage

1. Strengthen the disposable PostgreSQL workflow to exercise actual role grants and RLS denials.
2. Add concurrency and differential tests against the existing Firebase transaction tests, including duplicate submits, account-lock races, LIMIT fill-vs-cancel, repeated partial option closes, paise rounding and fee components.
3. Implement and test the trusted authenticated server adapter and identity mapping.
4. Only then consider a separate disposable Supabase staging project and an explicitly approved migration rehearsal.

**Status:** Read-only review recorded. No live database or Firebase changes made. PR #28 and PR #70 remain separate and unmerged.
