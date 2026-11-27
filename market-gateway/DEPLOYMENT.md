# ZENURA IGNITE — Supabase Market Gateway Deployment

## Architecture

- **Supabase** is the application backend: native Auth, Postgres, RLS and transactional RPCs.
- **Cloud Run** hosts one Node.js HTTP/SSE market gateway. It is not Firebase and does not use Firebase Auth, Firestore or Firebase Functions.
- The same Cloud Run process can run the leased Delivery LIMIT worker and, when explicitly enabled, separately leased Intraday LIMIT and equity protective-order workers. All execution workers remain disabled by default until their individual staging and release gates pass. There is **no separate Cloud Run Job or Cloud Scheduler** in the current design.
- Each user authorizes their own Upstox account. The gateway resolves that user's encrypted token only after validating the user's Supabase access token.
- All orders are virtual paper orders. The app does not submit orders to Upstox or an exchange.
- The frontend's gateway URL remains blank until a verified gateway is deployed.

## Important release gate: market-data rights

Public market-data deployment is blocked until two independent approvals are documented: (1) written provider/exchange rights for the exact data use, and (2) separate Indian securities-law/regulatory clearance for the public paper-trading product. API credentials alone do not prove redistribution/display rights. See [MARKET-DATA-COMPLIANCE.md](./MARKET-DATA-COMPLIANCE.md). The manual deployment workflow fails closed unless both approval flags are exactly `true` and both references are non-empty. These variables must never be populated with placeholders or self-attestations.

Do not bypass this check. If public real-time display is not approved, use a licensed source or implement the required delayed-data mode before launch.

## Required Google Cloud configuration

Use a dedicated Google Cloud project in `asia-south1` (Mumbai).

1. Enable billing and configure a budget alert before deploying.
2. Create a deployer/runtime service account. The current workflow uses the same account for image push, Cloud Run deployment and runtime secret access.
3. Grant the service account:
   - Artifact Registry Writer
   - Cloud Run Admin
   - Service Account User on itself/runtime identity
   - Secret Manager Secret Accessor on only the four secrets below
4. Configure GitHub Workload Identity Federation for repository `sharerohit111-pixel/zenura-ignite`, restricted to branch `main`. Do not use a downloaded service-account JSON key.
5. Create the Artifact Registry repository `zenura` in `asia-south1` (the workflow creates it if missing).
6. Map the chosen HTTPS gateway domain to the Cloud Run service and configure DNS before deployment.
7. Register the exact Upstox OAuth callback URL with the Upstox developer application.

### Secret Manager entries

Create these four secrets in the same Google Cloud project:

- `zenura-supabase-service-role`: the Supabase service-role secret key. Never place this in browser code or GitHub variables.
- `zenura-upstox-encryption-key`: a strong 32-byte encryption key in the exact encoding expected by the gateway.
- `zenura-upstox-client-id`: the Upstox API client ID.
- `zenura-upstox-client-secret`: the Upstox API client secret.

The Supabase publishable key is public and is already configured in the browser client; the workflow passes it to Cloud Run. No service-role or Upstox secret is embedded in the app.

## GitHub Actions configuration

The workflow `.github/workflows/deploy-supabase-market-gateway.yml` is manual-dispatch only and the job runs only from `main`.

Configure GitHub Actions **secrets**:

- `GCP_PROJECT_ID`
- `GCP_SERVICE_ACCOUNT`
- `GCP_WORKLOAD_IDENTITY_PROVIDER` (full Workload Identity Provider resource name)

Configure GitHub Actions **variables**:

- `MARKET_GATEWAY_URL`: verified HTTPS origin mapped to the Cloud Run service, without a trailing slash.
- `FRONTEND_ORIGIN`: exact HTTPS frontend origin, without a trailing slash.
- `UPSTOX_REDIRECT_URI`: exactly `MARKET_GATEWAY_URL/upstox/oauth/callback`.
- `ZENURA_APP_REDIRECT_URI`: exactly `FRONTEND_ORIGIN/markets/stocks/`.
- `MARKET_DATA_RIGHTS_APPROVED`: set to `true` only after written provider/legal approval is actually received.
- `MARKET_DATA_RIGHTS_REFERENCE`: reference to the verified written provider/exchange rights document.
- `MARKET_DATA_REGULATORY_APPROVED`: set to `true` only after separate product-level securities-law/regulatory clearance is independently verified.
- `MARKET_DATA_REGULATORY_REFERENCE`: reference to the signed counsel opinion and/or authorized regulatory clearance record.

The workflow validates these values and the four Secret Manager entries before it builds or deploys. It then:

1. Builds the Docker image from the repository root (the shared OAuth helpers under `functions/lib` are included).
2. Deploys `zenura-market-gateway` to Cloud Run.
3. Runs one warm instance (2 vCPU / 2 GiB) with CPU always allocated.
4. Explicitly keeps the Delivery LIMIT worker disabled (`PAPER_LIMIT_WORKER_ENABLED=false`).
5. Waits for instrument-master readiness and verifies that the Delivery LIMIT worker remains disabled in the public health response.
6. Updates the market-mode HTML page to use the verified gateway URL.

## Runtime and performance settings

The deployment uses:

- `--min 1 --max 5`: keep one instance warm; allow controlled scaling.
- `--cpu 2 --memory 2Gi`: gateway and chart-data requests.
- `--no-cpu-throttling`: required because the LIMIT worker runs in the background between HTTP requests.
- `--concurrency 40`: limit request concurrency per instance.
- `--timeout 3600`: supports long-lived Upstox V3 SSE streams.
- `PAPER_LIMIT_WORKER_ENABLED=false` by default. Do not enable the Delivery LIMIT worker until isolated staging submit/fill/cancel/expiry, concurrency, lease/retry, user-token isolation, market-data rights and compliance gates are independently verified and explicitly approved.
- `PAPER_INTRADAY_LIMIT_WORKER_ENABLED` remains unset/false by default. Do not enable it until the reviewed official NSE/BSE session calendar has been populated and verified in `paper_exchange_sessions`, the migration is approved/applied, and the live calendar/session smoke checks are complete. Optional interval: `PAPER_INTRADAY_LIMIT_WORKER_INTERVAL_MS`.
- `PAPER_PROTECTIVE_WORKER_ENABLED` remains unset/false by default. Enable only after the protective-order UI, SQL migration checks, end-to-end tests, written market-data rights and compliance gates are complete. Optional interval: `PAPER_PROTECTIVE_WORKER_INTERVAL_MS`.
- `PAPER_OPTIONS_LIMIT_ENABLED` and `PAPER_OPTIONS_LIMIT_WORKER_ENABLED` remain unset/false by default. Both must be explicitly true before the NSE long CE/PE Options LIMIT API or worker can run. Enable only after staging submit/fill/cancel/expiry, concurrent race, Upstox token-isolation, instrument/session, UI, written market-data rights and compliance checks are complete. Optional interval: `PAPER_OPTIONS_LIMIT_WORKER_INTERVAL_MS`. BSE Options LIMIT is not supported.

Every instance may start the worker loop, but the Postgres lease ensures only one worker is the active writer. Worker errors and instrument-master refresh failures use bounded exponential backoff. The public `/health` response exposes only safe readiness data: instrument-master availability, worker liveness and cycle counts. A cycle-level worker fault is distinguished from an individual user's expired token or rejected order; per-user failures are counted without falsely declaring the whole service unhealthy. It never exposes credentials or user data.

**Cost warning:** one warm 2-vCPU/2-GiB instance with CPU always allocated creates ongoing Google Cloud charges. Keep deployment manual and configure a billing budget/alert first.

## Supabase Auth configuration

Before public testing:

- Set the Supabase Auth Site URL to the actual frontend origin.
- Add the exact frontend origin and app return URL to the redirect allow-list.
- Configure production SMTP and verify email delivery/rate limits.
- Keep email/password or other enabled sign-in methods consistent with the actual UI and privacy policy.

These Auth settings are separate from the Cloud Run deployment workflow and must be verified in the Supabase project dashboard.

## Current order-type coverage

- Paper Trading equity MARKET orders are supported.
- Equity LIMIT orders are implemented for **Delivery**, but automatic execution remains unavailable while the Delivery LIMIT worker is disabled by default. Do not represent pending Delivery LIMIT orders as automatically executed until the worker has passed its separate release gates and is explicitly enabled.
- Intraday LIMIT now has a separate SQL reservation/fill/cancel/expiry lifecycle, session-aware quote validation, a dedicated leased worker and gateway routing. It remains **disabled by default** until official verified calendar rows are loaded and reviewed; the deployment workflow does not enable it.
- Futures LIMIT and NSE long CE/PE Options LIMIT have isolated draft backend/RPC/worker implementations and a gated Options LIMIT ticket UI under review; none is deployed or enabled in production. Options LIMIT is NSE-only and long-only; BSE Options LIMIT and short-option opening remain unsupported.
- Futures and long CE/PE option market-order paths are separate transactional flows.
- Paper Investing routes and its dedicated ledger have been retired under the Paper Trading-only product scope.
- Equity SELL-to-close stop-loss/target execution has a separately leased, bounded, fresh-quote worker implementation and an owner-bound cancellation API. The worker is **opt-in and disabled by default**. Protective-order creation UI/API are now integrated in the isolated stock-terminal module, with authenticated create/list/cancel flows, per-user idempotent retry protection and a fail-closed worker-enabled gate. CI covers the module contract and backend fill/cancel row-lock race. A staging browser-to-gateway trigger/cancel rehearsal and production readiness checks remain incomplete; the worker stays opt-in and disabled by default. Do not claim always-on protective execution until those gates pass. Futures and Options protective exits remain unsupported.

## NSE Options LIMIT API surface (draft, disabled by default)

- `POST /paper/derivative/limit-orders`: authenticated NSE CE/PE long-only LIMIT submit; requires a verified session, fresh executable depth, official instrument metadata, and an idempotency key.
- `GET /paper/derivative/limit-orders`: owner-scoped order and fill history.
- `DELETE /paper/derivative/limit-orders/:orderId`: owner-bound cancel for pending/partially-filled orders.
- The Options LIMIT ticket checks `/health` and remains disabled unless both `PAPER_OPTIONS_LIMIT_ENABLED=true` and `PAPER_OPTIONS_LIMIT_WORKER_ENABLED=true` are explicitly set. Both flags are unset/false in the current deployment.
- The worker uses the user's own connected Upstox token, fresh NSE bid/ask depth and a dedicated Postgres lease. No live broker/exchange order is sent.
- Enable only after staging browser-to-gateway submit/fill/cancel rehearsal, race tests, session/instrument validation, market-data rights approval and compliance sign-off.

## Manual build reference

The GitHub Actions workflow is the preferred deployment path. For a controlled local build from the repository root:

```sh
PROJECT_ID=YOUR_DEDICATED_GCP_PROJECT_ID
REGION=asia-south1
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/zenura/market-gateway:release"

gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -f market-gateway/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

Do not manually deploy around the market-data rights gate or the health checks.

## Internal service-role privilege preflight

Before staging sign-off, verify the narrowly scoped `service_role` privileges required by direct server-side reads/updates: `SELECT` on `upstox_connections`, `paper_market_worker_state`, `paper_orders`, `paper_protective_orders` and `paper_equity_positions`, plus `UPDATE` on `paper_market_worker_state` and `paper_protective_orders`. Draft migration `20261123230000_market_gateway_service_role_read_grants.sql` now grants only these server-side privileges; CI Run #1105 applied the ordered draft migrations to disposable PostgreSQL and passed explicit least-privilege assertions. Do not grant these privileges to `anon` or `authenticated`; keep internal tables inaccessible to client roles. The linked Supabase project has not had this draft migration applied, so live OAuth lookup and worker runtime remain unverified until the migration is reviewed and rehearsed in a separate staging Supabase project. Never apply this fix directly to production as part of the draft PR.


### Supabase Security Advisor: internal tables

The Security Advisor may report informational `rls_enabled_no_policy` findings for internal service-only tables such as `paper_market_worker_state`, `paper_market_stream_leases`, `upstox_connections`, `upstox_connection_controls`, `upstox_oauth_states` and `paper_margin_preview_limits`. These tables intentionally have RLS enabled without browser-role policies because access is mediated by narrowly scoped server-side RPCs and/or the trusted gateway; do not add broad `anon` or `authenticated` policies merely to silence the informational lint.

Preflight evidence from the currently linked production project confirms these six tables have no direct `anon` or `authenticated` SELECT/INSERT/UPDATE grants. The inspected internal RPCs are `SECURITY DEFINER`, owned by `postgres`, executable by `service_role`, and not executable by `anon` or `authenticated`. The separate direct gateway table grants remain intentionally limited to the tables listed above and must be rehearsed in staging before production rollout. Re-run the Security Advisor after staging migration and investigate any new ERROR/WARN findings rather than blanket-suppressing lints.

## Release safety

- No legacy customer data is imported.
- No Firebase production services are changed.
- Do not put Supabase service-role or Upstox secrets in frontend code, GitHub variables, commits or logs.
- Do not merge the draft PR, run production deployment, or submit to Google Play until the relevant backend, data-rights, Auth, device-performance and Android release gates pass.
