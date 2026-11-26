# ZENURA IGNITE — Crypto Paper Gateway

This service is deliberately separate from `market-gateway`. It exposes only Crypto paper-trading routes and has no Upstox, NSE/BSE, instrument-master, or Indian-market imports.

## Routes
- `GET /health`
- `GET /crypto/account`
- `GET /crypto/portfolio`
- `POST /crypto/orders`
- `POST /crypto/limit-orders`
- `POST /crypto/limit-orders/:orderId/cancel`

## Runtime
- Node.js 22; install with `npm ci` after generating and reviewing the package lock in a controlled build environment.
- Configure Supabase URL, publishable key, server-only service-role secret and exact CORS origins using the host secret manager. Never commit service-role credentials.
- Set `CRYPTO_LIMIT_WORKER_ENABLED=true` only after Crypto migrations and regression tests pass in an isolated staging database.
- The service verifies Supabase access tokens server-side, uses service-role access only for allowlisted Crypto RPCs, and uses the user's JWT for RLS-scoped reads. State-changing Crypto order routes have a bounded per-process limit of 30 requests per minute per socket peer; deploy a shared edge/API-gateway limiter as well when running multiple replicas.
- MARKET execution uses a fresh Binance Spot trade quote; LIMIT fills use a fresh server-side quote and leased Crypto-only worker. USD/INR conversion is fetched server-side.
- All orders are simulated only. No real exchange order, custody, deposit, withdrawal, leverage, or margin functionality exists.
- No hosting, DNS, secret configuration, migration, or deployment has been performed.

## Safety gates
1. Apply Crypto migrations only to an isolated staging Supabase project/branch.
2. Run all SQL regression tests against staging, including auth and two-user RLS isolation.
3. Configure CORS and secrets in the isolated gateway host.
4. Exercise auth, MARKET/LIMIT BUY/SELL, idempotency, cancellation, reservations and worker recovery.
5. Obtain explicit approval before production migration or deployment.

## Latest CI result
GitHub Actions run [#45105183954](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45105183954) completed successfully on 2026-11-23 at branch commit `054476c4b66c802cb72131b13de13e036ab608fa`, including the Crypto gateway changes and worker-batch safety adjustment. It applied all Crypto migrations to disposable PostgreSQL 16 and passed:
- Full-position LIMIT SELL reservation release and ledger accounting
- Reserved-position DELETE guard
- MARKET SELL protection for quantity reserved by pending LIMIT SELL orders
- Authenticated row-level isolation across Crypto accounts, positions, orders and ledger
- LIMIT BUY reservation aggregation, cancellation release, better-price fill accounting and idempotent replay
- Browser module syntax, gateway unit tests and Crypto/Indian Market client isolation

This is disposable PostgreSQL CI, not a live Supabase staging integration test, and does not authorize deployment.
