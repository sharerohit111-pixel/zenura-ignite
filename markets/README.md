# ZENURA IGNITE — Market workspace

## Product architecture and isolation
- `/markets/` is the market selector.
- `/markets/stocks/` is the independent Indian-market workspace.
- `/crypto/` remains the existing crypto paper-trading app. The Indian market link is available from the Crypto app menu; the crypto simulator, payment flow, balances, local-storage keys and history are not shared with Indian-market data.
- Indian-market authentication uses the root Firebase project `zenura-ignite-technologies`. The legacy Crypto app continues to use its existing Firebase project.
- Indian-market watchlists, paper accounts, equity orders, derivative orders and stream leases use separate server-side collections. Browser clients cannot directly read or write these collections.

## Implemented Indian-market capabilities
- Official Upstox instrument-master ingestion and search for indices, cash equities, futures and options.
- Upstox OAuth launch, callback, one-time state validation, encrypted server-side token storage, connection status and disconnect controls.
- Authenticated quote snapshots and Market Data Feed V3 streaming through the separate Node.js 22 Cloud Run gateway.
- Historical candle proxy and chart interval controls (1m, 5m, 15m, 1h, 1D).
- Option-chain snapshots with expiry selection and CE/PE strike rows.
- Separate per-user watchlists and fresh-quote status.
- Independent Indian-market virtual account, initialized server-side at ₹10,00,000 only when `INDIAN_PAPER_STARTING_CASH_PAISE=100000000` is configured.
- NSE/BSE cash-equity market BUY/SELL paper orders using fresh provider quotes, server-side validation, idempotency and Firestore transactions.
- Long CE/PE option BUY and SELL-to-close paper orders, with indicative itemized charges and separate derivative positions/history.
- Futures broker-margin preview for verified contracts. This is a preview only: it does not reserve virtual funds or place a futures order.
- Portfolio valuation, order history, derivative positions/history and quote freshness checks.

## Explicit product boundaries
- This is an educational paper-trading simulation. No broker/exchange order is sent.
- Live market data is unavailable until the Cloud Run gateway is deployed, configured with the correct Firebase/Firestore access and Upstox encryption key, and the user completes Upstox OAuth.
- Standard Upstox access tokens expire at the documented daily cutoff; users must reconnect after expiry.
- Futures execution, opening short options, margin reservation, equity limit/stop orders, full cash-equity fee simulation, dividends and corporate actions are not enabled.
- Option fee estimates are indicative and are not a broker contract note. Verify current tariffs and exchange schedules before production.
- Do not label cached, stale, placeholder or missing quotes as live. Reject paper orders if the quote or instrument metadata is not fresh and verified.
- Confirm Upstox account entitlements and all exchange/provider data-display and redistribution terms before exposing market data to other users.

## Firebase and Cloud Run deployment dependencies
1. Confirm the Firebase project is exactly `zenura-ignite-technologies`; the repository `.firebaserc` pins the CLI default to this project.
2. Enable Google and Email/Password Authentication and add the production domain to Authorized Domains.
3. Configure the four Upstox/Firebase secrets documented in `market-gateway/DEPLOYMENT.md`. Never commit or paste secrets into chat, browser code or public configuration.
4. Deploy Firestore rules/indexes and Firebase Functions only after reviewing the existing Premium/Razorpay functions and confirming the target project.
5. Deploy `market-gateway/` to Cloud Run with Node.js 22, exact `ALLOWED_ORIGINS`, `UPSTOX_TOKEN_ENCRYPTION_KEY`, `INDIAN_PAPER_STARTING_CASH_PAISE=100000000`, and a dedicated least-privilege service account.
6. Set the verified Cloud Run HTTPS URL in the `market-gateway-url` meta tag in `markets/stocks/index.html`. Never use a placeholder URL.
7. Complete Google/email sign-in, Upstox OAuth, feed, candles, option-chain, watchlist, cash equity and derivative end-to-end checks with an authorized account.

## Automated verification
The `.github/workflows/indian-market-checks.yml` workflow checks the existing Crypto page's inline JavaScript syntax, Indian-market browser modules, Firebase Functions syntax/configuration, gateway dependencies, gateway unit tests and Firestore-emulator integration tests, plus the gateway Docker image and non-root runtime. A passing CI run does not replace Firebase/Upstox live-account, deployment, security or data-entitlement verification.

## Release gate
Keep PR #11 in Draft until the workflow passes and the Firebase, Upstox, Cloud Run, security and provider-entitlement checks above are completed. Do not claim the market is live or production-ready before those checks are evidenced.
