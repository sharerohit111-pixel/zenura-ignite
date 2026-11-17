# ZENURA IGNITE Premium — backend integration requirements

## Product rules
- New accounts receive a one-time 72-hour demo window beginning at server-side account creation.
- Plans: 1 month ₹99, 3 months ₹199, 6 months ₹399, 1 year ₹799.
- A plan purchase is a one-time payment by default.
- Optional recurring renewal is a separate explicit opt-in. It must remain OFF unless the customer affirmatively consents to a provider-supported recurring mandate and sees the amount, frequency, next debit date and cancellation terms.
- Subscription validity is granted only after server-side payment verification and a verified provider webhook. Never trust browser storage, query parameters, screenshots or a client-side success callback.
- Demo expiry / subscription expiry blocks order execution server-side; public market data, charts, watchlist, account history and portfolio viewing remain accessible.
- Existing local paper-trading data must not be reset or silently migrated.

## Required production architecture
1. Firebase Authentication (Google and email) or equivalent verified identity.
2. Serverless backend (Firebase Cloud Functions / Cloud Run) with secrets stored server-side.
3. Razorpay Orders API for one-time checkout; verify HMAC signature on server.
4. Optional Razorpay Subscriptions / supported recurring mandate flow. Create mandate only after explicit consent; persist mandate and provider subscription IDs. Provide cancellation endpoint and webhook handling.
5. Webhook endpoint validates provider signature against raw request body and processes events idempotently.
6. Server-side entitlement document keyed by immutable auth UID: trialStartedAt, trialEndsAt, status, planId, currentPeriodStart, currentPeriodEnd, autoRenew, provider IDs, updatedAt.
7. Order execution authorization checks entitlement on the trusted backend. A static GitHub Pages app cannot enforce premium restrictions securely by itself.
8. Admin tools to view users, payment state, expiry and manually grant/revoke entitlements with audit log.

## Security / operations
- Never put Razorpay Key Secret, webhook secret, Firebase Admin credentials or service-account keys in GitHub Pages JavaScript.
- Never accept amount, plan duration or user UID as authoritative from the browser; resolve price and identity on the server.
- Verify payment amount, currency INR, order ID, payment ID and account ownership.
- Make webhook processing idempotent and tolerate retries/out-of-order events.
- Handle failed, pending, refunded, disputed and cancelled payments; do not activate premium for pending/failed payments.
- Use UTC timestamps, server time, and explicit grace-period policy.
- Provide a clear cancellation path for Auto-Renewal and retain a receipt / payment history.
- Test with provider test mode before production keys and live transactions.

## Go-live prerequisites
- Owner must create/verify the Razorpay merchant account, complete KYC, link settlement bank account, enable applicable payment methods and recurring mandates, and provide configured Firebase project/auth domains.
- Keep checkout disabled until backend endpoints, webhook verification, auth, entitlement enforcement and sandbox tests pass.
