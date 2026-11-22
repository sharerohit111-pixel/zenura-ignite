# ZENURA IGNITE — Supabase + Cloud Run deployment

## Architecture and hard boundaries

- **Authentication:** Supabase Auth (new users only).
- **Application data:** Supabase Postgres, SQL migrations, RLS and transactional RPCs.
- **Market provider:** Upstox OAuth and Market Data Feed V3.
- **Long-lived gateway:** Node.js 22 on Google Cloud Run. Cloud Run is a standalone container runtime, not Firebase.
- **Frontend:** static ZENURA IGNITE web app.
- **No Firebase runtime:** this release does not deploy Firebase Functions, use Firebase Auth, use Firestore, import old customer data or depend on Firebase UID mapping. The legacy Firebase gateway file is not the active server entrypoint.

Never put the Supabase service-role key, Upstox client secret, Upstox access token or token-encryption key in browser code, GitHub source, build args or public frontend configuration.

## 1. Supabase project preparation

Project: `atvbjibhunvzpmfagagm` (Mumbai, ap-south-1).

1. Confirm the project is the intended ZENURA IGNITE project.
2. Apply the reviewed SQL migrations to a disposable Postgres test database first. Run the repository CI migration/RPC tests and Supabase Auth/RLS integration tests before any production migration.
3. Enable Supabase Auth email/password. Configure the production Site URL and allowed redirect URLs for `https://zenuraignite.com/markets/stocks/` and the Paper Investing route.
4. Keep email confirmation enabled for production accounts. Configure SMTP/deliverability before public launch.
5. Verify RLS is enabled on every user-owned table. Test two different Supabase users and prove neither can read or mutate the other's orders, balances, positions, watchlists or chart settings.
6. Store the Supabase project URL and publishable key as non-secret Cloud Run environment values. Obtain the service-role key from Supabase and store it only in Google Secret Manager.
7. Do not execute destructive SQL, disable RLS, expose service-role credentials, or apply unreviewed migrations to the live project.

The starting virtual capital is ₹10,00,000 (100,000,000 paise) per new account, initialized server-side once. Paper Trading and Paper Investing use distinct account ledgers; no existing customer balances are imported.

## 2. Upstox OAuth configuration

Create a dedicated encryption key locally:

```sh
openssl rand -base64 32
```

Store the value only in Google Secret Manager as `UPSTOX_TOKEN_ENCRYPTION_KEY`. Add the Upstox client ID and secret as Secret Manager secrets too.

Use a stable HTTPS custom domain for the gateway callback, for example:

`https://market-api.zenuraignite.com/upstox/oauth/callback`

Register that exact URL in the Upstox Developer Console and set the same value as `UPSTOX_REDIRECT_URI`. Configure `ZENURA_APP_REDIRECT_URI=https://zenuraignite.com/markets/stocks/`. The OAuth callback consumes a one-time state value and stores the encrypted access token in Supabase; the browser never receives that provider token.

Upstox standard access tokens expire on the provider's daily schedule. There is no assumed refresh-token flow; users must reconnect when expired.

## 3. Cloud Run gateway deployment

Use a dedicated Google Cloud project and a dedicated runtime service account. This is a Cloud Run container deployment; do not run Firebase CLI commands or deploy Firebase Functions for this app.

### Required secrets in Secret Manager

- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTOX_TOKEN_ENCRYPTION_KEY`
- `UPSTOX_CLIENT_ID`
- `UPSTOX_CLIENT_SECRET`

### Required environment values

- `SUPABASE_URL=https://atvbjibhunvzpmfagagm.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>`
- `UPSTOX_REDIRECT_URI=https://market-api.zenuraignite.com/upstox/oauth/callback`
- `ZENURA_APP_REDIRECT_URI=https://zenuraignite.com/markets/stocks/`
- `ALLOWED_ORIGINS=https://zenuraignite.com`
- `MAX_INSTRUMENT_KEYS=100`
- `INDIAN_PAPER_STARTING_CASH_PAISE=100000000` (documented product default; runtime account RPC remains authoritative)

Grant the runtime service account only Secret Manager Secret Accessor on the four secrets. The gateway uses Supabase over HTTPS and does not require Firestore IAM, Firebase Admin SDK permissions or Firebase service accounts.

Build and deploy from the repository root:

```sh
gcloud run deploy zenura-market-gateway \
  --project YOUR_DEDICATED_GCP_PROJECT_ID \
  --source market-gateway \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account YOUR_GATEWAY_SERVICE_ACCOUNT@YOUR_DEDICATED_GCP_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars SUPABASE_URL=https://atvbjibhunvzpmfagagm.supabase.co,SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY,UPSTOX_REDIRECT_URI=https://market-api.zenuraignite.com/upstox/oauth/callback,ZENURA_APP_REDIRECT_URI=https://zenuraignite.com/markets/stocks/,ALLOWED_ORIGINS=https://zenuraignite.com,MAX_INSTRUMENT_KEYS=100 \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,UPSTOX_TOKEN_ENCRYPTION_KEY=UPSTOX_TOKEN_ENCRYPTION_KEY:latest,UPSTOX_CLIENT_ID=UPSTOX_CLIENT_ID:latest,UPSTOX_CLIENT_SECRET=UPSTOX_CLIENT_SECRET:latest
```

For a responsive chart/quote experience, the reference deployment keeps one warm gateway instance, gives it 2 vCPU/2 GiB, allows bounded concurrency and sets a 60-minute request timeout for SSE streams. This has ongoing Cloud Run cost; configure a billing budget and alert, and tune max instances against Upstox account-wide stream limits.

The Cloud Run endpoint is publicly reachable for browser CORS and the Upstox OAuth callback. This does **not** disable application authentication: every private API route verifies the Supabase access token. The startup check refuses to run unless the exact HTTPS frontend origin is present in `ALLOWED_ORIGINS`.

Map `market-api.zenuraignite.com` to the Cloud Run service and verify the custom domain/certificate before registering the callback in Upstox. Confirm the returned Cloud Run URL and `/health` endpoint. Health is only a liveness check; it does not prove authentication, RLS, OAuth, market quotes or order accounting.

## 4. Frontend gateway configuration

The static pages currently contain an intentionally empty `market-gateway-url` meta value. After Cloud Run and the custom domain are deployed and verified, update both:

- `markets/stocks/index.html`
- `markets/investing/index.html`

Set the meta value to the exact verified gateway origin, e.g. `https://market-api.zenuraignite.com`. Never commit a placeholder, unverified endpoint or secret. Deploy the frontend only after the gateway health check, CORS and authenticated smoke tests pass.

## 5. Required end-to-end release gates

1. `npm install`, `npm run check`, `npm test` in `market-gateway/`.
2. Supabase migration/RPC tests on disposable Postgres and live Supabase Auth/RLS integration tests with two isolated test users.
3. New-user account initialization: ₹10,00,000 Paper Trading and ₹10,00,000 Paper Investing ledgers; repeated initialization must not reset a balance.
4. Verify instrument master search covers NSE/BSE equities, indices, futures and CE/PE contracts, including expiries, lot sizes and tick sizes.
5. Verify Upstox OAuth state replay protection, encrypted token storage, expiry handling, disconnect and reconnect.
6. Verify historical candles, V3 streaming, stale-quote rejection, stream lease renewal, reconnect, backpressure and provider outage behavior.
7. Verify MARKET and LIMIT equity orders, cash reservation/release, order idempotency, no double fill, insufficient funds/holdings, and cross-user isolation.
8. Verify Paper Investing buy/sell ledger, charges, weighted average cost, realized/unrealized P&L and retry behavior.
9. Verify CE/PE and futures contracts, expiry, lot/tick validation, charges, margin controls and all enabled order directions.
10. Verify chart rendering and performance on low/mid-range Android devices: indicators, drawing tools, templates, resize/orientation, theme switching, language switching and saved chart state.
11. Verify no uncaught errors, memory leaks, stale subscriptions, runaway polling or duplicate market streams.
12. Produce signed Android release build, test on real devices, complete Play Store policy/data safety declarations and staged rollout checklist.

Do not call the app production-ready or submit to Google Play until all required gates pass. Play Store review time is separate from engineering and release-preparation time.
