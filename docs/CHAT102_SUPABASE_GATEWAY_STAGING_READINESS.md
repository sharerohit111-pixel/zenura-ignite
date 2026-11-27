# CHAT 102 — Supabase Market Gateway Staging Readiness

**Audit date:** 2026-11-27  
**Status:** BLOCKED — documentation-only audit record; no deployment authorized.

## Scope and safety

This review is limited to repository inspection and CI metadata. No Cloud Run deployment, GitHub Actions deployment workflow dispatch, hosted Supabase write, migration, production credential use, broker order, live feed activation, or Crypto-file modification was performed.

The Delivery LIMIT worker must remain disabled in every staging configuration for this audit.

## Verified source identity

- Repository: `sharerohit111-pixel/zenura-ignite`
- Isolated audit branch: `audit/chat102-gateway-staging-readiness-2026-11-27`
- Starting commit: `089fbf91ef2babb44f2bc2a1406374ca980392e2`
- Candidate branch: `release/s-trade-mainline-integration-2026-11-25`
- GitHub comparison of candidate branch against the starting commit: identical (0 ahead / 0 behind).
- Candidate branch comparison to `main`: 39 ahead / 0 behind; merge base is `dbb7eeaf8ef2fe5a2a77040e8c95b5f8c16c08c9`.
- PR #245 remains Draft/open/unmerged. This audit branch is separate; no PR was opened by this audit.

## Findings

### 1. Docker build reproducibility — BLOCKED

Inspected `market-gateway/Dockerfile` and `market-gateway/package.json`.

- The repository does not contain `market-gateway/package-lock.json`.
- Dockerfile runs `npm install --omit=dev`, not `npm ci`.
- Dependency versions in package.json are pinned, but the full transitive dependency graph is not lockfile-pinned.
- No Docker build was executed in this audit environment. A previous local clone attempt failed because GitHub DNS/network access was unavailable.

**Required before staging:** generate and review a committed npm lockfile, use `npm ci --omit=dev`, then run the image build and container smoke test in disposable CI.

### 2. Deployment workflow — BLOCKED / DO NOT DISPATCH

Inspected `.github/workflows/deploy-supabase-market-gateway.yml`.

- Workflow is `workflow_dispatch` and its deploy job is gated to `refs/heads/main`.
- It grants `contents: write` and `id-token: write`.
- It deploys Cloud Run with `--allow-unauthenticated`.
- It sets `PAPER_LIMIT_WORKER_ENABLED=true` and a 2-second interval.
- It expects the public health endpoint to report an active Delivery LIMIT worker.
- After deployment it writes the gateway URL into `markets/stocks/index.html`.

These behaviours conflict with this audit's staging-only/no-frontend-write/worker-disabled constraints. **Do not dispatch this workflow.** A separate staging-only workflow must be designed and reviewed before any staging deployment; it must not modify the production deployment workflow as part of this documentation-only audit.

### 3. Runtime configuration — PARTIAL STATIC REVIEW

Inspected `market-gateway/supabase-server.js` and `market-gateway/lib/supabase-runtime.js`.

- Startup requires the Upstox encryption key, client ID, client secret, and HTTPS callback/app redirect configuration.
- Runtime requires HTTPS `SUPABASE_URL`, a publishable key, and a server-only service-role key.
- Allowed origins must be exact HTTPS origins and include the app redirect origin.
- Supabase authentication uses `auth.getUser(token)`; the verified UUID is used for server RPC identity.
- User-scoped reads use a publishable-key client with the caller's Bearer JWT; server RPCs use the privileged service client and an RPC allowlist.
- These are static code observations, not proof that staging secrets, IAM, Auth, OAuth callback registration, or runtime network access are configured correctly.

**Required before staging:** validate variable names and presence using dummy/disposable configuration only; never print secret values. Verify service-account least privilege, Secret Manager bindings, callback URLs, allowed origins, and Supabase Auth reachability in an isolated environment.

### 4. Health and readiness — BLOCKED

- `GET /health` returns `ok: true` without checking Supabase connectivity.
- No separate `/ready` route was found in the inspected server source.
- The current workflow's health predicate requires instrument-master readiness and a successful Delivery LIMIT worker cycle, which is not an acceptable readiness condition while the worker must remain disabled.

**Required before staging:** keep `/health` as liveness only; add a bounded, non-mutating readiness check that verifies required runtime dependencies without exposing secrets or user data. Worker-disabled status must be an explicit expected state, not a deployment failure.

### 5. API contract and authentication — PARTIAL STATIC REVIEW

- Supabase runtime requires a Bearer token and validates it through Supabase Auth `getUser`.
- The RPC allowlist rejects unknown RPC names and caller-supplied `p_user_id`; the server injects the verified user UUID.
- This review did not exercise HTTP endpoints against a running container or hosted Supabase. No live API contract, CORS, timeout, rate-limit, or streaming integration result is claimed.

**Required before staging:** add disposable HTTP contract tests for unauthenticated/expired tokens, valid test identity, cross-user access denial, invalid RPC, caller-supplied identity rejection, safe health/readiness responses, and stream cleanup. Use mocked Supabase/provider clients or disposable test services only.

## Disposable staging guards and HTTP contract tests added

Two isolated files were added on the audit branch:

- `market-gateway/lib/staging-worker-policy.js`: fail-closed policy helper that rejects any staging environment where Delivery LIMIT, Intraday LIMIT, Futures LIMIT submission/worker, Options LIMIT submission/worker, or equity protective worker flags are set to `true`. Unset and explicit false values are accepted.
- `market-gateway/test/supabase-staging-contract.test.js`: Node test coverage for the policy helper and a disposable local HTTP instance. It uses dummy Supabase values, does not call `start()`, does not connect to Supabase or Upstox, verifies secret-free health output, checks all worker status fields begin disabled, verifies missing Bearer tokens are rejected by order/portfolio endpoints, and checks allowed/denied CORS preflights.

**Important limitation:** the policy helper is not yet wired into a staging deployment workflow or production gateway startup. A future staging-only workflow must invoke this helper before any cloud action. These tests were committed but were not executed in this environment; exact-head CI is still required. The health endpoint assertions document current liveness behaviour only and do not create a readiness endpoint.

## CI evidence

GitHub Actions metadata for commit `089fbf91ef2babb44f2bc2a1406374ca980392e2` showed 7/7 associated pull-request workflows completed successfully:

- Validate Mega Kirana Spark Backend
- S-TRADE Authenticated Browser Security
- S-TRADE Demo Screen Wiring Tests
- Firebase read-only export tool tests
- Paper Trading Supabase SQL smoke test
- Validate Indian Market Code
- S-TRADE Futures Options Demo UI Integration

This is existing CI evidence only. It does not establish a Docker image build, a Cloud Run startup, hosted Supabase connectivity, OAuth callback operation, or staging API contract pass.

## Exact-head disposable CI result

A dedicated workflow, `.github/workflows/chat102-gateway-contract-tests.yml`, was added on this isolated branch. It has read-only repository permission, installs only the gateway package dependencies without writing a lockfile, runs the disposable local HTTP tests, and asserts that the run event/ref are the audit branch. It contains no Cloud Run deployment step, no Supabase credentials, and no hosted service calls.

- Final corrected run: [GitHub Actions run #3](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45956770945)
- Commit: `56bf22b1927c64a08f495781a3c50bc95b73ae24`
- Result: **success**
- Node.js: 22.23.5
- npm dependency install: 262 packages, `--no-package-lock`
- Disposable contract tests: **5 passed, 0 failed, 0 skipped**
- Audit-branch event assertion: passed.

Two earlier workflow attempts failed only in the additional workflow-guard step (first a file-presence assumption, then a self-matching grep expression); in both attempts the five application contract tests passed. The guard was simplified to assert the push event and exact isolated branch, and run #3 passed.

This CI proves the five local contract tests only. It does not prove reproducible dependency resolution, Docker build/startup, real Supabase authentication/connectivity, Cloud Run IAM, OAuth, readiness, or hosted staging. The package-lock and readiness blockers remain open.

## Exit criteria

Do not mark CHAT 102 complete until all are satisfied:

1. A reviewed lockfile and reproducible Docker build pass.
2. A staging-only deployment path is isolated from production and cannot write frontend files.
3. Staging is authenticated; no unauthenticated public Cloud Run access.
4. Delivery LIMIT worker and all other trading workers remain disabled.
5. Liveness/readiness semantics are separated and tested.
6. Disposable HTTP/API contract tests pass, including authentication and owner isolation.
7. Container startup and shutdown tests pass with dummy/disposable configuration.
8. No production deploy, hosted database mutation, real broker order, or live-feed activation occurs without separate written approval.

**Current conclusion:** staging deployment readiness is not established. This branch records the blockers only; it does not authorize deployment or change runtime behaviour.
