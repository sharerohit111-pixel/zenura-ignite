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
- A disposable GitHub Actions Docker image build has now passed using the existing Dockerfile.
- A disposable container module-load smoke test with dummy Supabase configuration has also passed; it imports the gateway app but does not start the HTTP server or contact Supabase/Upstox.
- The Dockerfile still runs `npm install --omit=dev`; this successful build is not reproducible/lockfile-backed.

**Required before staging:** generate and review a committed npm lockfile, change the Docker build to `npm ci --omit=dev`, then rerun the image build and container startup/readiness smoke tests in disposable CI.

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

### 4. Health and readiness — PARTIAL IMPLEMENTATION; hosted verification BLOCKED

- `GET /health` remains a liveness-only response and does not check Supabase connectivity.
- `GET /ready` has now been added. It returns 503 until gateway startup has completed, then performs bounded read-only GET probes to Supabase Auth `/auth/v1/health` and the Data API `/rest/v1/`.
- Each dependency probe has a 3-second default timeout. Responses expose only boolean check results; no keys, tokens, user data, or upstream response bodies are returned.
- The probe requires an HTTPS project origin and a configured publishable key. It does not issue RPCs or write database data.
- Worker status is not used as a readiness failure condition. Delivery LIMIT and all other trading workers must still be disabled in staging through the separate staging policy gate.
- The new unit tests cover both successful dependencies, an individual dependency failure, invalid configuration, network failure/timeout, and the HTTP endpoint's 503 response before startup.

**Remaining limitation:** the readiness unit tests use injected mock fetch responses. No hosted Supabase request, real Auth/Data API connectivity, container startup, or Cloud Run readiness check has been performed.

### 5. API contract and authentication — PARTIAL STATIC REVIEW

- Supabase runtime requires a Bearer token and validates it through Supabase Auth `getUser`.
- The RPC allowlist rejects unknown RPC names and caller-supplied `p_user_id`; the server injects the verified user UUID.
- This review did not exercise HTTP endpoints against a running container or hosted Supabase. No live API contract, CORS, timeout, rate-limit, or streaming integration result is claimed.

**Required before staging:** add disposable HTTP contract tests for unauthenticated/expired tokens, valid test identity, cross-user access denial, invalid RPC, caller-supplied identity rejection, safe health/readiness responses, and stream cleanup. Use mocked Supabase/provider clients or disposable test services only.

## Disposable staging guards and HTTP contract tests added

Two isolated files were added on the audit branch:

- `market-gateway/lib/staging-worker-policy.js`: fail-closed policy helper that rejects any staging environment where Delivery LIMIT, Intraday LIMIT, Futures LIMIT submission/worker, Options LIMIT submission/worker, or equity protective worker flags are set to `true`. Unset and explicit false values are accepted.
- `market-gateway/test/supabase-staging-contract.test.js`: Node test coverage for the policy helper and a disposable local HTTP instance. It uses dummy Supabase values, does not call `start()`, does not connect to Supabase or Upstox, verifies secret-free health output, checks all worker status fields begin disabled, verifies missing Bearer tokens are rejected by order/portfolio endpoints, and checks allowed/denied CORS preflights.

**Important limitation:** the worker policy helper is still not wired into a staging deployment workflow. A future staging-only workflow must invoke it before any cloud action. It is deliberately not wired into production gateway startup because production worker configuration has separate operational semantics. The new `/ready` endpoint is implemented, but its tests use mocked dependencies and do not prove hosted connectivity.

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

- Initial corrected run: [GitHub Actions run #3](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45956770945), 5 tests passed.
- Expanded final run: [GitHub Actions run #7](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45957238132)
- Final tested commit: `5a0449e9207e30aed39fdf6f7a3eb8beb1ae5498`
- Result: **success**
- Node.js: 22.23.5
- npm dependency install: 262 packages, `--no-package-lock`
- Disposable contract and readiness tests: **10 passed, 0 failed, 0 skipped**
- Docker image build: **passed**; base image `node:22-slim`, production dependency install added 92 packages.
- Container module-load smoke test with dummy Supabase values: **passed**. This imported the app inside the built image; it did not start the HTTP listener or contact hosted services.
- Audit-branch event/ref assertion: passed.

Two earlier workflow attempts failed only in the additional workflow-guard step; their five application tests passed. The guard was corrected, and run #3 passed. Expanded run #6 passed the 10 tests and Docker build. Run #7 additionally passed the container module-load smoke test.

This CI proves disposable local tests, a Docker image build, and container module loading only. It does not prove a reproducible lockfile-based build, a live container startup, hosted Supabase Auth/Data API connectivity, Cloud Run IAM, OAuth callback operation, or hosted staging. The package-lock, actual startup, and hosted readiness blockers remain open.

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
