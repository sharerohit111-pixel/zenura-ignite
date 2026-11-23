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
- Configure the three Supabase values and CORS allowlist using the host's secret manager. Never commit service-role credentials.
- Set `CRYPTO_LIMIT_WORKER_ENABLED=true` only after Crypto-only migrations and regression tests pass in a disposable/staging database.
- The service uses server-side Supabase Auth verification, server-only service role RPCs, user-scoped RLS reads, fresh Binance spot trade quotes, and a USD/INR reference rate.
- All orders are simulated only. No exchange order, custody, deposit, withdrawal, leverage, or margin functionality exists.
- No hosting, DNS, secret configuration, migration, or deployment has been performed.

## Safety gates
1. Apply Crypto migrations only to an isolated staging Supabase project.
2. Run all SQL regression tests against PostgreSQL/Supabase staging.
3. Configure CORS and secrets in the isolated gateway host.
4. Exercise auth, market/limit buy/sell, idempotency, cancellation, reservation and worker recovery.
5. Obtain explicit approval before production migration or deployment.
