# Indian Market deployment runbook

The checked-in Firebase Web App config in `firebase-config.js` identifies the dedicated Indian-market Firebase project as `zenura-ignite-technologies`. The root `.firebaserc` now pins Firebase CLI deployments to that project. The Crypto app's separate Firebase project is not selected by this branch.

## 1. Firebase project and Authentication

1. Confirm the Firebase Console project ID is exactly `zenura-ignite-technologies`.
2. In Authentication → Sign-in method, enable **Google** and **Email/Password**.
3. In Authentication → Settings → Authorized domains, add the production website host (for example `zenuraignite.com`) and any deliberate preview host.
4. Confirm the web app in this project matches the public config in `firebase-config.js`.
5. Install Firebase CLI, authenticate as a project administrator, then run from repository root:

```sh
firebase use default
firebase deploy --only firestore:rules,firestore:indexes,functions
```

This deploys the repository's existing Premium/Razorpay Functions as well as the new Indian-market callable and callback functions to this project. Review existing production Functions and secrets before deploying; do not deploy if this is not the intended project.

## 2. Upstox OAuth secrets

Create a fresh 32-byte encryption key locally and store it only in Secret Manager:

```sh
openssl rand -base64 32
firebase functions:secrets:set UPSTOX_CLIENT_ID
firebase functions:secrets:set UPSTOX_CLIENT_SECRET
firebase functions:secrets:set UPSTOX_REDIRECT_URI
firebase functions:secrets:set UPSTOX_TOKEN_ENCRYPTION_KEY
```

Set `UPSTOX_REDIRECT_URI` to the exact deployed callback URL:

`https://asia-south1-zenura-ignite-technologies.cloudfunctions.net/upstoxOAuthCallback`

Register that exact URL in the Upstox Developer app. Use the same generated encryption key in the gateway's Secret Manager environment variable. Never commit the key or paste it into browser configuration.

### Upstox token lifecycle

The standard OAuth access token expires at **03:30 AM Asia/Kolkata time** (the same day if generated before the cutoff, otherwise the following day). Upstox does not provide a standard refresh-token flow for this OAuth grant; users must complete Upstox authorization again after expiry. The callback stores the calculated 03:30 IST cutoff, and the connection UI displays the expiry and reconnect guidance.

Upstox also documents a separate one-year Analytics Token, but it is strictly read-only and limited to supported GET APIs. It cannot be used for trading operations. Do not substitute it for a user's OAuth token or distribute it to app users; follow Upstox's credential and exchange-data terms.
## 3. Indian paper-account starting balance

The existing product specification sets a ₹10,00,000 virtual starting capital. Cash equities and long-option paper orders share the same `indianPaperAccounts/{uid}` document and `cashPaise` balance; equity holdings remain in `positions`, while derivative holdings are isolated in `derivativePositions`. The authenticated `GET /paper/account` endpoint initializes this shared account once. Derivative orders are stored separately in `indianDerivativeOrders`. No second derivative starting balance is created. Set the starting capital server-side before enabling accounts:

```sh
INDIAN_PAPER_STARTING_CASH_PAISE=100000000
```

Do not put this value in client-side code. The gateway deliberately refuses to initialize accounts until the value is explicitly configured.

## 4. Cloud Run gateway

Deploy `market-gateway/` as a separate Cloud Run service with Node.js 20. Configure:
- `UPSTOX_TOKEN_ENCRYPTION_KEY`: the same Secret Manager value as the Firebase Function.
- `ALLOWED_ORIGINS=https://zenuraignite.com` (use the exact production origin, no wildcard).
- `INDIAN_PAPER_STARTING_CASH_PAISE=100000000`.
- A dedicated service account with only the required Firestore access to `upstoxConnections`, `indianMarketWatchlists`, `indianPaperAccounts`, `indianPaperOrders`, and `indianDerivativeOrders`.
- Public HTTPS ingress so browser requests can reach the service; the gateway itself validates Firebase ID tokens on protected endpoints. Do not disable application authentication.

After deployment, set the exact Cloud Run HTTPS URL in the `market-gateway-url` meta tag in `markets/stocks/index.html`. Do not point the frontend at a placeholder or unverified URL.

## 5. Verification before production

1. Run `npm test` and `npm run check` in `market-gateway/`, plus the GitHub Actions workflow.
2. Verify Google and Email/Password sign-in against the intended Firebase project.
3. Complete Upstox OAuth and confirm the encrypted token is stored server-side only.
4. Verify `/health`, official instrument search, candles, option chain, watchlist quotes and streaming using an authorized account.
5. Test cash-equity BUY/SELL with fresh quotes, idempotent retry, insufficient cash, insufficient holdings, stale quote and cross-user access denial.
6. Confirm balances and data remain separate from Crypto.
7. Obtain confirmation that the Upstox account has the required API/data entitlements and that the intended exchange data display complies with provider/exchange terms.

## Current product boundary

This release simulates market BUY/SELL for NSE/BSE cash equities and long CE/PE option BUY orders only. Option BUY fills use a fresh server-fetched Upstox quote and atomically debit the shared Indian-market virtual cash balance, including an itemized indicative Upstox fee estimate. The option-chain UI exposes these BUY controls, and derivative portfolio/history views are separate from cash-equity holdings. Derivative SELL, futures, short options, margin reservation, limit/stop orders, complete cash-equity fee simulation, dividends and corporate actions are not enabled. Charge estimates are not a broker contract note; verify current tariffs and exchange schedules before production. Do not enable the release until automated tests, Firebase/Upstox live checks, security review and provider entitlements are verified. Keep PR #11 in draft until all deployment and provider-account checks pass.
