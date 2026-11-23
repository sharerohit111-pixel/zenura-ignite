# Indian Market Backend Infrastructure Audit
Date: 2026-11-23
Scope: Supabase project `atvbjibhunvzpmfagagm`; GitHub repository `sharerohit111-pixel/zenura-ignite`; Indian-market backend infrastructure only.
Safety: Production was inspected read-only. No SQL DDL/DML, migration, secret read, deployment, or configuration change was performed. No crypto or trading-business-logic files were changed.

## Environment evidence
- Supabase project name: `zenura-paper-trading`; status `ACTIVE_HEALTHY`; PostgreSQL 17.12; region `ap-south-1`.
- Supabase development-branch listing returned only the default `main` branch (no separate staging branch/project identified).
- GitHub default branch: `main`; repository is accessible with push permission.
- Supabase Edge Function listing returned an empty array.
- Database migration history contains 15 entries, versions 20261122083748 through 20261122123415.
- GitHub `main` tree has 101 entries and contains no `supabase/` directory, no checked-in migration SQL, no Supabase config, and no Upstox/OAuth worker source. The market-gateway area currently contains only `lib/derivative-contract.js` and two tests.

## Findings

### Blocker — no isolated staging environment
No separate Supabase staging project or development branch was found. Do not test migrations or modify schema until a staging target is explicitly provisioned/identified. Production remains read-only.

### High — deployed backend source is not reproducible from this repository
The database has 15 applied migrations and multiple privileged RPCs, but the repository's main branch has no Supabase migration files/configuration or Edge Function source. Edge Function inventory is empty. This prevents source-to-deployed-schema review and reliable CI migration replay from this repository.

### Medium — six RLS-enabled internal tables have no policies
Supabase Security Advisor reported `rls_enabled_no_policy` for:
- `paper_margin_preview_limits`
- `paper_market_stream_leases`
- `paper_market_worker_state`
- `upstox_connection_controls`
- `upstox_connections`
- `upstox_oauth_states`

Read-only catalog inspection confirms these tables have RLS enabled and no policies. Their table grants show no `anon` or `authenticated` table privileges; service_role has no direct SELECT/INSERT/UPDATE/DELETE grants in the inspected ACL view. These appear intentionally service-only, but the no-policy state should be documented as intentional and tested with role-level negative access tests. Do not add broad policies merely to silence the advisor.

### Positive control — RPC execute grants are restricted
Inspected public SECURITY DEFINER RPCs (including order/lease/OAuth routines) show explicit EXECUTE grants to `service_role` and owner `postgres`, with no PUBLIC/anon/authenticated EXECUTE in their ACLs. The private helper `_paper_quote_age_is_fresh` and `rls_auto_enable` are owner-only. This is a good baseline; retain it and add regression checks against accidental PUBLIC execute grants.

### Positive control — RLS ownership predicates
User-facing account, order, position, watchlist, and chart tables inspected have RLS enabled. User-facing SELECT policies use `auth.uid() = user_id`; user-mutable chart/watchlist tables include ownership checks in INSERT/UPDATE policies, including UPDATE WITH CHECK.

### Medium — OAuth and worker logic only partially auditable
Database RPC definitions are present for OAuth state creation/one-time consumption, encrypted-token persistence, disconnect generation invalidation, and stream/worker leases. Observed safeguards include SHA-256 state-hash shape validation, <=10-minute OAuth state expiry, single-use state consumption, generation checks on token save, and lease-token matching on release/renewal. However, callback HTTP handling, PKCE/state generation, Upstox client-secret storage, token encryption/decryption key custody, refresh-token rotation, retry behavior, market-data ingestion, and worker deployment code are not present in the inspected repository or Supabase Edge Function inventory. These cannot be certified from the available evidence.

### Medium — worker lease design needs integration-level fencing review
The worker lease RPCs use bounded TTLs (5–300 seconds), allowed state keys, and conditional acquisition based on lease expiry; release checks the lease token. The worker-state row also stores cursor fields. The worker consumer implementation is absent, so it is not possible to verify that every write/checkpoint is fenced by the current lease token, that stale workers cannot commit after lease expiry, or that lease renewal failure stops processing. Require those checks in staging before production readiness.

### Low — repository test references a missing module
`market-gateway/test/paper-portfolio-valuation.test.js` imports `../lib/paper-portfolio-valuation`, but that module is absent from the inspected `main` tree. The test therefore appears unable to load in the current checked-in tree. This was not changed because it is outside the infrastructure-only scope and no test runner was available through the GitHub connector.

## Recommended gated remediation sequence
1. Identify/provision an isolated Supabase staging project; do not create one without explicit environment/cost approval.
2. Export/reconcile the 15 migration definitions into version-controlled `supabase/migrations` and add `supabase/config.toml`; verify clean replay against staging.
3. Add catalog-based CI assertions: exposed-schema tables must have intended RLS; privileged RPCs must not grant EXECUTE to PUBLIC/anon/authenticated; service-only tables must remain inaccessible to client roles.
4. Add role-level negative tests for the six service-only tables and positive tests for authenticated owner-scoped tables.
5. Restore or add the missing market-gateway valuation module only in its owning workstream; do not alter it in this infrastructure audit.
6. Supply the actual Upstox callback/token worker and market-data Gateway source for review; test OAuth state replay, generation races, encrypted token handling, stale quote rejection, lease fencing, crash recovery, and duplicate job delivery in staging.
7. Run Supabase security/performance/health advisors and application tests in staging; require evidence before any production rollout.

## Changes made
- Created branch: `audit/indian-market-backend-infra-2026-11-23`
- This audit report only. No application code, database schema, secrets, or production configuration changed.


### Informational — performance advisor reports 17 unused indexes
The Supabase performance advisor reported 17 indexes as unused at the observation time, including the market-worker pending-order indexes, Upstox OAuth state indexes, and several account/order/position indexes. This is not evidence that they are safe to drop: the project is newly created and workload coverage may be low. Preserve them until representative workload statistics and query plans are collected in staging. No index was removed. The health advisor returned no findings.


### Additional infrastructure inspection — role boundaries and lease timing
- Database role catalog shows `anon`, `authenticated`, and `service_role` are non-login, non-superuser roles with no direct role memberships. `authenticator` is the login role and can assume the API roles; `postgres` is the administrative role. This is consistent with the expected Supabase role model.
- All inspected SECURITY DEFINER functions have an empty function-level `search_path` and schema-qualify referenced relations; the non-definer quote freshness helper pins `search_path=pg_catalog`. Explicit EXECUTE ACLs remain restricted to `service_role` and owner `postgres`.
- Lease RPCs accept caller-supplied `p_now_ms` and calculate expiry from that value, while some metadata uses database `clock_timestamp()`. Since only service_role can execute these RPCs, this is not a direct client exploit, but worker correctness depends on trusted server time and disciplined clock synchronization. Recommend deriving authoritative lease time inside PostgreSQL (or explicitly validating drift) during a staging-tested hardening change.
- Worker lease acquisition is atomic via INSERT/ON CONFLICT with expiry predicate. Release matches the lease token. Stream lease renewal requires matching lease ID, non-revoked status, and unexpired lease. The consumer still needs fencing checks on every side effect/checkpoint; source code was not available to verify that end-to-end.
- One read-only catalog query using a non-existent `information_schema.schema_privileges` view failed; no database state was changed. Role membership was subsequently inspected using `pg_auth_members`.
