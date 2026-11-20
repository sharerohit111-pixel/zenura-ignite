# Indian Market deployment runbook

The checked-in .firebaserc default points to the production Firebase project zenura-ignite-technologies. **Never rely on that default for testing.** All staging deployment commands must pass an explicit, separately verified non-production project ID. The deployment scripts below refuse the production project. No staging project or live provider credentials are assumed to exist until independently verified.

## 1. Firebase staging project and Authentication

1. Create or verify a dedicated non-production Firebase project and Firestore database. Record its exact project ID as FIREBASE_STAGING_PROJECT_ID.
2. Confirm that this ID is not zenura-ignite-technologies and that the project is not shared with the Crypto or production app.
3. In the staging Firebase Console, enable **Google** and **Email/Password** sign-in and add only the staging website host to Authorized domains.
4. Confirm the staging web app configuration, Firestore rules and required indexes are deliberately configured for that staging project. Do not change the checked-in production web configuration as part of staging setup.
5. Authenticate the Firebase CLI, then create the four OAuth secrets in that same staging project and deploy only the four connection Functions. Every secret operation must explicitly target staging; never let the Firebase CLI select the `.firebaserc` production default:

```sh
export FIREBASE_STAGING_PROJECT_ID=YOUR_VERIFIED_STAGING_PROJECT_ID
test -n "$FIREBASE_STAGING_PROJECT_ID"
test "$FIREBASE_STAGING_PROJECT_ID" != "zenura-ignite-technologies"
firebase functions:secrets:set UPSTOX_CLIENT_ID --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_CLIENT_SECRET --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_REDIRECT_URI --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_TOKEN_ENCRYPTION_KEY --project "$FIREBASE_STAGING_PROJECT_ID"
npm run --prefix functions deploy
```

The deploy script passes --project "$FIREBASE_STAGING_PROJECT_ID" explicitly and refuses to run when the variable is missing or points at production. Do not use firebase use default or rely on .firebaserc for staging.

The scheduled processPendingPaperLimitOrders worker is deliberately excluded. Keep it undeployed until staging OAuth, account isolation, quote-freshness, LIMIT placement/fill/cancel, reservation-release and operational monitoring checks pass, and separate staging worker-deployment approval is recorded. If approved, deploy only that worker to the same verified staging project:

```sh
npm run --prefix functions deploy:limit-worker
```

Do not run either command until the staging project exists, its Firestore database and required secrets are configured, and staging deployment approval has been recorded. No production deployment is authorized by this runbook. Production rollout requires a separate explicit approval and a separately reviewed deployment plan.

Do **not** use --only functions: that can redeploy existing Premium/Razorpay Functions. Firestore rules and indexes are project-wide resources, not isolated per feature. Review the complete rules/indexes and verify existing Crypto/Premium entitlements before deploying any rules or indexes, even to staging. Always pass the explicit staging project ID:

```sh
firebase deploy --project "$FIREBASE_STAGING_PROJECT_ID" --only firestore:rules,firestore:indexes
```

## 2. Upstox OAuth secrets

Create a fresh 32-byte encryption key locally and store it only in Secret Manager. For staging, every secret operation must explicitly target `FIREBASE_STAGING_PROJECT_ID`; do not use the production project or CLI default:

```sh
openssl rand -base64 32
firebase functions:secrets:set UPSTOX_CLIENT_ID --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_CLIENT_SECRET --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_REDIRECT_URI --project "$FIREBASE_STAGING_PROJECT_ID"
firebase functions:secrets:set UPSTOX_TOKEN_ENCRYPTION_KEY --project "$FIREBASE_STAGING_PROJECT_ID"
```

Set the staging `UPSTOX_REDIRECT_URI` to the exact callback URL for the staging project (not production):

`https://asia-south1-${FIREBASE_STAGING_PROJECT_ID}.cloudfunctions.net/upstoxOAuthCallback`

Register that exact staging URL in the staging Upstox Developer app. Use the same staging-only generated encryption key in the staging gateway's Secret Manager environment variable. Never reuse production OAuth credentials or encryption keys, commit a key, or paste it into browser configuration.

### Upstox token lifecycle

The standard OAuth access token expires at **03:30 AM Asia/Kolkata time** (the same day if generated before the cutoff, otherwise the following day). Upstox does not provide a standard refresh-token flow for this OAuth grant; users must complete Upstox authorization again after expiry. The callback stores the calculated 03:30 IST cutoff, and the connection UI displays the expiry and reconnect guidance.

Upstox also documents a separate one-year Analytics Token, but it is strictly read-only and limited to supported GET APIs. It cannot be used for trading operations. Do not substitute it for a user's OAuth token or distribute it to app users; follow Upstox's credential and exchange-data terms.
## 3. Indian paper-account starting balance

The existing product specification sets a ₹10,00,000 virtual starting capital. Cash equities and long-option paper orders share the same `indianPaperAccounts/{uid}` document and `cashPaise` balance; equity holdings remain in `positions`, while derivative holdings are isolated in `derivativePositions`. The authenticated `GET /paper/account` endpoint initializes this shared account once. Derivative orders are stored separately in `indianDerivativeOrders`. No second derivative starting balance is created. Set the starting capital server-side before enabling accounts:

```sh
INDIAN_PAPER_STARTING_CASH_PAISE=100000000
```

Do not put this value in client-side code. The server-side default is ₹10,00,000 when the variable is omitted; set the variable explicitly in each Cloud Run environment to make the intended starting balance auditable. An invalid explicit value causes account initialization to fail closed.

## 4. Cloud Run gateway

Deploy `market-gateway/` as a separate Cloud Run service with Node.js 22. Configure:
- `UPSTOX_TOKEN_ENCRYPTION_KEY`: the same Secret Manager value as the Firebase Function.
- `ALLOWED_ORIGINS=https://zenuraignite.com` (use the exact production origin, no wildcard).
- `INDIAN_PAPER_STARTING_CASH_PAISE=100000000`.
- A dedicated service account with least-privilege Firestore IAM permissions for the target database. **Firestore IAM is database-level, not collection-level, and Admin SDK calls bypass Firestore Security Rules.** Keep gateway code access limited to `upstoxConnections`, `indianMarketWatchlists`, `indianPaperAccounts`, `indianPaperOrders`, `indianDerivativeOrders`, `indianMarketStreamLeases` (live-feed lease coordination), and `indianMarginPreviewLimits` (per-user margin-preview cooldown).
- Public HTTPS ingress so browser requests can reach the service; the gateway itself validates Firebase ID tokens on protected endpoints. Do not disable application authentication.

After deployment, set the exact Cloud Run HTTPS URL in the `market-gateway-url` meta tag in `markets/stocks/index.html`. Do not point the frontend at a placeholder or unverified URL.

### Staging Cloud Run deployment (separate project only)

After the staging Firebase project and staging-only secrets are verified, deploy the gateway with an explicit project flag. Replace the staging host and service-account placeholders with verified staging values. Do not run this against production.

```sh
: "${FIREBASE_STAGING_PROJECT_ID:?Set the verified staging project ID}"
test "$FIREBASE_STAGING_PROJECT_ID" != "zenura-ignite-technologies"
gcloud run deploy zenura-indian-market-gateway-staging \
  --project "$FIREBASE_STAGING_PROJECT_ID" \
  --source market-gateway \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account "YOUR_STAGING_GATEWAY_SERVICE_ACCOUNT@$FIREBASE_STAGING_PROJECT_ID.iam.gserviceaccount.com" \
  --set-env-vars "ALLOWED_ORIGINS=https://YOUR_STAGING_WEB_HOST,INDIAN_PAPER_STARTING_CASH_PAISE=100000000,MAX_INSTRUMENT_KEYS=100" \
  --set-secrets UPSTOX_TOKEN_ENCRYPTION_KEY=UPSTOX_TOKEN_ENCRYPTION_KEY:latest
```

The staging runtime service account must have only the required staging Firestore access and Secret Manager access. Confirm the named secret exists in the staging project and contains the staging encryption key. Verify the returned staging URL and `/health`; do not update the production frontend's gateway URL. Configure a separate staging frontend with the staging Firebase web configuration and exact staging gateway URL. No staging resource is assumed to exist until verified in Google Cloud.
### Reproducible production Cloud Run deployment — NOT AUTHORIZED

The following production commands are reference documentation only. Do not execute them as part of staging preparation or this PR's current approval.

Run these commands from the repository root after replacing the service-account placeholder with a dedicated service account that has the required Firestore access and Secret Manager access. Do not grant project Owner or Editor.

```sh
gcloud config set project zenura-ignite-technologies
gcloud run deploy zenura-indian-market-gateway \
  --source market-gateway \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account YOUR_GATEWAY_SERVICE_ACCOUNT@zenura-ignite-technologies.iam.gserviceaccount.com \
  --set-env-vars ALLOWED_ORIGINS=https://zenuraignite.com,INDIAN_PAPER_STARTING_CASH_PAISE=100000000,MAX_INSTRUMENT_KEYS=100 \
  --set-secrets UPSTOX_TOKEN_ENCRYPTION_KEY=UPSTOX_TOKEN_ENCRYPTION_KEY:latest
```

The service is intentionally internet-reachable for browser CORS requests; application routes still verify Firebase ID tokens. Grant the runtime service account Secret Manager Secret Accessor on the encryption-key secret and the minimum Firestore database IAM role needed by the Admin SDK. Confirm the Firestore database and Cloud Run service are in the same intended project. Do not copy the encryption key into `--set-env-vars`, source files, build arguments, or browser code.

After deployment, obtain and verify the service URL before editing the frontend:

```sh
gcloud run services describe zenura-indian-market-gateway --region asia-south1 --format='value(status.url)'
curl --fail --show-error "$(gcloud run services describe zenura-indian-market-gateway --region asia-south1 --format='value(status.url)')/health"
```

The health response is a liveness check only; it does not prove Firebase authentication, Firestore permissions, Upstox OAuth, or live streaming works. Complete the end-to-end checks below before setting the frontend gateway URL or enabling production access. Deploy with the intended production origin only; preview origins must be added deliberately and explicitly.

## 5. Verification before production

1. Run `npm test` and `npm run check` in `market-gateway/`, plus the GitHub Actions workflow.
2. Verify Google and Email/Password sign-in against the intended Firebase project.
3. Complete Upstox OAuth and confirm the encrypted token is stored server-side only.
4. Verify `/health`, official instrument search, candles, option chain, watchlist quotes and streaming using an authorized account.
5. Test cash-equity BUY/SELL with fresh quotes, idempotent retry, insufficient cash, insufficient holdings, stale quote and cross-user access denial.
6. Confirm balances and data remain separate from Crypto.
7. Obtain confirmation that the Upstox account has the required API/data entitlements and that the intended exchange data display complies with provider/exchange terms.

## Current product boundary

This release simulates market BUY/SELL for NSE/BSE cash equities and long CE/PE option BUY plus SELL-to-close orders only. Option BUY and SELL-to-close fills use a fresh server-fetched Upstox quote and atomically debit or credit the shared Indian-market virtual cash balance after itemized indicative Upstox fee estimates. Entry charges are included in long-option average cost and realized P&L includes exit charges. The option-The cash-equity paper-trading backend supports market BUY/SELL and pending LIMIT BUY/SELL orders. LIMIT orders reserve virtual cash or shares, execute only through the scheduled server-side worker when a fresh Upstox quote reaches the limit, and release reservations on cancellation. These remain paper simulations: no broker or exchange order is submitted. The LIMIT worker is not production-active until its explicitly allowlisted Firebase Function is deployed and staging verification is complete. Stop-loss/stop orders, opening short options, futures execution, margin reservation, complete cash-equity fee simulation, dividends and corporate actions are not enabled. Option charge estimates are not a broker contract note; verify current tariffs and exchange schedules before production. Do not enable the release until automated tests, Firebase/Upstox live checks, LIMIT-order staging tests, security review and provider entitlements are verified. Keep PR #28 in draft until all deployment and provider-account checks pass.


### Futures margin preview verification

The UI calls the authenticated `POST /paper/derivative/margin-preview` gateway route only for a selected official NSE/BSE futures contract. The route requires a fresh Upstox quote and calls the Upstox V2 margin endpoint with the selected product `D` (Delivery) or `I` (Intraday). It returns a preview and virtual-cash shortfall only. It does not reserve margin, persist an order, mutate the paper account, or submit an exchange/broker order. Verify this behavior with the gateway test suite and an authorized Upstox account before any production release. Futures execution remains disabled.
