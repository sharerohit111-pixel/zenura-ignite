# ZENURA IGNITE — Paper Trading & Paper Investing

This is an isolated app folder deployed alongside (not replacing) the ZENURA IGNITE website.

## Current interface and simulator
- Separate Watchlist, Trading Terminal and Profit & Loss pages; selecting a watchlist asset opens its chart and order ticket.
- Live public Binance Spot prices and candlestick history for BTC, ETH, BNB, SOL, XRP, ADA, DOGE and AVAX.
- Lightweight Charts candlestick chart with 1m, 5m, 15m, 1h, 4h and 1d intervals, plus chart fullscreen.
- INR-denominated simulated Market Buy/Sell orders, 0.10% paper fee, balance checks, holdings, CSV history.
- Optional stop-loss and take-profit prices attached to an open long position. A trigger is simulated from the live ticker stream while the page is open and connected; it is not an exchange-side order and will not run reliably in the background or while the device is offline.
- Profit/loss summary with green positive and red negative unrealized P&L treatment.
- Side drawer with page navigation and a persisted Night appearance toggle.
- ₹10,00,000 virtual starting balance stored locally in the current browser.
- Responsive PWA shell and versioned service worker; HTML navigation uses network-first caching to pick up app updates.

## Supabase cloud paper-trading integration
- The Crypto Terminal uses its own `crypto/supabase-client.js` module and Supabase Auth (email/password and Google OAuth). The client targets the existing Supabase project but does not import the Indian Market frontend module. It does not use Firebase Authentication for the crypto trading session.
- Signed-in users receive a separate cloud crypto paper account initialized with ₹10,00,000 virtual INR. Cloud MARKET and LIMIT orders, portfolio/order history synchronization, and LIMIT cancellation are routed through the trusted Supabase gateway.
- The browser sends only the market symbol, side, quantity, LIMIT price where applicable, and an idempotency key. The trusted gateway obtains the authenticated user from the Supabase session and derives execution prices, INR reference rate, fee and accounting inputs server-side.
- The zenura-crypto-api-url meta value is intentionally blank until a verified gateway is deployed. Signed-in orders fail closed while it is blank; no local trade is silently substituted for a failed cloud request.
- Cloud LIMIT processing requires the deployed gateway's leased worker. A pending LIMIT order remains reserved until it is filled or cancelled.
- Signed-in cloud stop-loss/target execution and cloud account reset are not enabled yet. The UI blocks those actions rather than pretending they are server-backed.
- Guest paper trading remains a separate local-browser simulation. Guest balances, positions, risk settings and history do not sync across devices and may be lost if browser storage is cleared.
- Legacy Firebase files and payment-related integrations are outside this crypto trading backend migration; do not infer that their data or entitlements have been migrated to Supabase.

## Important limitations
- Paper trading only: no real exchange orders, custody, deposits, withdrawals, leverage or margin.
- USDT-to-INR is estimated using a USD/INR reference rate; it is not a direct exchange USDT/INR quote.
- GitHub Pages hosts the static PWA only. The Node.js market gateway must be hosted separately; do not run it on GitHub Pages.
- A live price feed is not guaranteed if the provider, ISP, browser or region blocks public market endpoints.
- Public market-data display and gateway deployment remain subject to written provider permission and applicable legal/compliance review.

## UPI payments and manual Premium approval
- The Premium plans use the UPI ID `9756591106-4@ybl` and payee label `Rohit Kumar`. The app generates a plan-specific UPI QR and UPI intent.
- Customers must sign in, pay the exact plan amount, enter the UPI transaction reference (UTR), and submit a payment request.
- Requests are stored in Firestore `payments` with status `pending`. The signed-in admin `sharerohit111@gmail.com` sees an **Admin Payment Approvals** entry in the side menu.
- The admin must independently match the UTR and amount against the actual bank/UPI account credit before choosing **Approve & activate**. Rejected requests do not grant access.
- Approval writes an entitlement to `users/{uid}/private/entitlement` with an expiry date. The Firestore rules restrict approval and entitlement writes to the verified admin email; customers can only create/read their own payment requests.
- **Required Firebase step:** In Firebase Console → Firestore Database → Rules, copy and publish the complete contents of `crypto/firestore.rules`. Until these rules are published, payment requests and approvals will fail closed.
- This is manual bank reconciliation, not automatic payment verification. A QR payment or entered UTR is not proof of receipt. Never approve from a screenshot alone. For automated confirmation, add a compliant payment provider/bank integration with server-side verification and webhooks.
- Firebase Web API keys are public app identifiers; never add service-account JSON, private keys, or admin passwords to this repository.

## Future platform architecture
- Google Sign-In: Firebase Authentication; add account-scoped cloud storage and security rules before enabling multi-user access.
- Premium: Razorpay order creation, signature verification and subscription webhooks must run server-side. Premium feature access must come from verified server entitlements.
- Google Ads: disabled until publisher ID, consent/privacy disclosures and compliant placements are configured.
- Never place secrets, service-account keys, Razorpay secret keys or admin credentials in frontend files.

## Deployment
The repository's existing GitHub Pages workflow publishes the repository root. This app lives at `/crypto/`, so it can be visited without replacing the root website.


## Isolated development branch status (2026-11-23)
- Crypto frontend, auth/cloud adapters, and additive Crypto-only SQL migrations are staged on `feature/crypto-only-supabase-backend-2026-11-23`.
- The shared Indian-market gateway implementation is deliberately not copied into this branch. A dedicated Crypto-only Node.js gateway has been extracted under `crypto-gateway/` with its own environment configuration and worker boundary.
- Crypto-only disposable PostgreSQL CI covers seven SQL regression suites, frontend syntax, gateway unit tests and Crypto/Indian Market isolation. The latest full run is [#45109955835](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45109955835), successful at branch head `d86725fe07d815944b69cbe0717668d3683dd40d`.
- Isolated Supabase staging validation and gateway hosting remain pending. No Supabase Crypto migration has been applied and no production deployment has been performed.


## Latest isolated verification — 2026-11-23
GitHub Draft PR [#85](https://github.com/sharerohit111-pixel/zenura-ignite/pull/85) remains open, unmerged and in draft state.
Latest run #45109955835 completed all 16 primary workflow steps successfully, including seven disposable-PostgreSQL regression suites, Crypto browser syntax/isolation checks, and standalone gateway tests.
Read-only inspection of the connected Supabase Production project confirms that no `paper_crypto_*` tables or Crypto migrations are installed there. No dedicated isolated Crypto staging database is currently available; the existing project must not receive these migrations as a substitute.
No Crypto Edge Functions are deployed in the connected Supabase project. No Crypto gateway hosting, secrets, production migrations or deployment have been changed.
Next release gates: provision/identify isolated staging with approved cost, apply only the reviewed Crypto migrations there, perform authenticated end-to-end MARKET/LIMIT tests, then implement server-side stop-loss/target and account reset before enabling those signed-in controls.


## Supabase staging cost quote — 2026-11-23
- The ZENURA IGNITE Supabase organization was verified as `afmowmxpfuykokvgjfxb`.
- Supabase returned a development-branch estimate of **$0.01344 per hour**. At continuous usage this is approximately **$0.32256 per day** or **$9.68 per 30-day month** (720 hours).
- This is a quote/estimate only. No staging branch has been created and no cost has been incurred. Obtain explicit agreement to the quoted charge before creating the branch.
- A development branch is based on the selected parent project's migrations; verify parent-project suitability and migration impact before creation. Do not use a production parent if it would expose production data/schema to unintended branch operations.


## Virtual account reset implementation — 2026-11-23
- Added `20261123150000_s_trade_crypto_account_reset.sql` with a service-role-only, idempotent reset RPC and a private reset audit table.
- Reset cancels pending Crypto LIMIT BUY/SELL orders through the existing canonical cancellation RPC, verifies all cash/base-quantity reservations are released, closes open positions, and restores the account's original virtual starting cash.
- Completed order and trade-ledger history is preserved; reset events are stored separately with previous/reset cash, previous realized P&L, cancelled-order count, and closed-position count.
- Added authenticated gateway route `POST /crypto/account/reset` and a cloud adapter method. The adapter retains its request UUID after a failed request so a safe retry is idempotent.
- Added disposable-PostgreSQL regression coverage for reservation release, position closure, balance restoration, history preservation and idempotent replay; added this test to the Crypto CI workflow.
- GitHub Actions run [#45110691382](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45110691382) passed all 17 workflow steps on the implementation head. All eight disposable-PostgreSQL regression suites passed, including the new reset lifecycle test; browser syntax, gateway tests and Crypto/Indian Market isolation also passed. This is CI against disposable PostgreSQL, not live Supabase staging.
- Account reset is exposed as an API/client method but is not yet wired to a user-facing confirmation control.
