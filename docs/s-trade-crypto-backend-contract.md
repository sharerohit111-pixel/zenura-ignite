# S-TRADE Crypto Spot Backend Contract

Status: draft implementation on `feature/s-trade-crypto-supabase-backend-2026-11-22`. The migration has **not** been applied to the Supabase project.

## Scope and existing product behavior
- INR-denominated simulated spot trading for the existing Binance Spot asset catalog.
- New Supabase Auth UUID ownership; no Firebase UID conversion or legacy customer-account import.
- Each new crypto paper account starts with ₹10,00,000 virtual INR, matching the existing Crypto Terminal's `START=1000000`.
- Existing Crypto Terminal paper fee is 0.10%; gateway uses the same 0.001 rate.
- Binance USDT pair price is converted to INR using the USD/INR reference rate from the existing reference-rate provider. Both the USDT execution price and applied INR rate are recorded on the order.
- Separate crypto cash account, positions, orders, and append-only INR cash ledger.
- Market orders are the only executable order type in this first migration. LIMIT is not enabled by this migration; client-side exit-limit and stop/target code is not considered a reliable server-side risk engine.
- Authenticated Crypto Terminal uses `crypto/supabase-cloud.js` to initialize the cloud account, submit BUY/SELL market orders and synchronize cloud portfolio/order history. It retains guest-local behavior separately.
- For signed-in users, local-only exit orders, stop-loss/target triggers and account reset are blocked until server-side equivalents exist. The cloud API URL remains empty until the trusted gateway is deliberately deployed, so authenticated trading fails closed.
- No live exchange order placement, custody, deposits, or withdrawals.

## Server runtime
The existing `market-gateway/supabase-server.js` is the canonical server API. It exposes:
- `GET /crypto/account` — idempotently initializes and reads the user's INR paper account.
- `POST /crypto/orders` — accepts symbol, side, quantity and idempotency key; verifies the Supabase session, fetches Binance trade + INR reference rate server-side, calculates the existing 0.10% fee, then invokes the transactional RPC.
- `GET /crypto/portfolio` — reads the authenticated user's cash account, positions and recent order history.

The browser must never submit or control the user UUID, execution price, quote timestamp, FX rate, fee, or request fingerprint. The gateway derives the user from the verified Supabase Auth JWT. The service-role key remains server-only. The cloud client sends only symbol, side, quantity and an idempotency key; the server calculates all execution/accounting inputs.

## Database security and accounting
- All four tables enable RLS. Authenticated users can read only rows where `user_id = auth.uid()`.
- Direct client writes are revoked. Mutations go through SECURITY DEFINER functions with an empty search_path; EXECUTE is granted only to `service_role`.
- The database enforces a 15-second quote age and 2-second future-clock tolerance as a secondary guard.
- The RPC locks the account and position, enforces idempotency, uses fixed-precision NUMERIC arithmetic, and updates account, position, order and ledger atomically.
- The cash ledger is append-only: a dedicated database trigger rejects UPDATE/DELETE even for service-role sessions, and the service role no longer has UPDATE/DELETE grants on the ledger.
- Buy cost basis includes the fee. Sell realized P&L deducts the sell fee and allocates cost basis proportionally for partial exits.

## Validation completed in CI
- PostgreSQL migrations compile and apply in a disposable PostgreSQL container.
- Crypto BUY, partial SELL, fee/cost-basis, realized-P&L, exact retry/idempotency and stale-quote checks pass.
- Negative crypto cases reject zero quantity, unsupported symbols, future-dated quotes, overselling and insufficient virtual INR.
- Crypto RLS checks verify another user cannot read accounts, positions, orders or ledger entries; authenticated direct account mutation is denied.
- A separate migration enforces append-only crypto ledger semantics; CI asserts both UPDATE and DELETE fail with SQLSTATE 55000 under the service role.
- Existing market, options, futures, Paper Investing, OAuth/stream and gateway regression checks remain in the same passing CI workflow.
- Frontend module syntax, deployment workflow YAML, gateway security checks and production container build pass.

## Remaining work before production
1. Run the crypto schema and authenticated read/write flows in a disposable Supabase branch/project (in addition to the PostgreSQL CI fixture).
2. Deploy and verify the trusted gateway, CORS allowlist, secrets and external market-data rights; then verify account initialization, BUY/SELL and portfolio/history end-to-end.
3. Add crypto-specific concurrency/idempotency race tests.
4. Implement LIMIT order reservation/fill/cancel and server-side stop-loss/target execution as separate tested increments.
5. Remove Firebase/localStorage trading persistence only after cloud cutover and guest-data behavior are explicitly preserved.
6. Audit Paper Investing dependencies separately; do not delete database objects until app-wide references and regression tests prove they are unused.

## Safety
No production database migration has been applied and no gateway deployment has been performed. Existing Firebase/Google Cloud resources and customer data have not been modified.
