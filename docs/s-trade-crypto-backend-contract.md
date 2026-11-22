# S-TRADE Crypto Spot Backend Contract

Status: draft implementation on `feature/s-trade-crypto-supabase-backend-2026-11-22`. The migration has **not** been applied to the Supabase project.

## Scope and existing product behavior
- INR-denominated simulated spot trading for the existing Binance Spot asset catalog.
- New Supabase Auth UUID ownership; no Firebase UID conversion or legacy customer-account import.
- Each new crypto paper account starts with ₹10,00,000 virtual INR, matching the existing Crypto Terminal's `START=1000000`.
- Existing Crypto Terminal paper fee is 0.10%; gateway uses the same 0.001 rate.
- Binance USDT pair price is converted to INR using the USD/INR reference rate from the existing reference-rate provider. Both the USDT execution price and applied INR rate are recorded on the order.
- Separate crypto cash account, positions, orders, and append-only INR cash ledger.
- MARKET orders are supported by the initial spot RPC. A follow-up additive migration introduces server-side LIMIT reservations, fills and cancellations; the trusted worker uses fresh Binance trades and server-side USD/INR reference rates.
- LIMIT BUY reserves INR cash including estimated fees; LIMIT SELL reserves uncommitted base quantity. Cancel releases the reservation. Fills require a fresh quote at or better than the submitted limit and update positions, cash, fees, realized P&L and the append-only ledger atomically.
- Crypto LIMIT processing uses a dedicated lease/cursor, separate from the equities LIMIT worker.
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

## Validation completed for Crypto LIMIT lifecycle
- Disposable PostgreSQL CI covers pending BUY reservation, idempotent replay, worse-than-limit rejection, favorable fill, SELL quantity reservation, cancellation release, SELL fill and INR cash/realized-P&L accounting.
- Worker eligibility tests reject unsupported symbols, malformed quantity, stale/future quotes and unfavorable prices.
- Concurrent duplicate LIMIT submission and fill-versus-cancel race coverage passes; the database transaction permits only one winning lifecycle transition.
- Explicit NULL LIMIT side rejection is covered before any reservation/order write.
- CI run 45033083572 completed successfully with all 49 workflow steps passing on commit 436251b67858200b280584bcb50eeebf65d26eea.

## Current integration boundary
- The Crypto Terminal loads the Supabase auth and cloud modules. Signed-in MARKET and LIMIT orders use the trusted gateway; cloud portfolio and order history are published back into the existing UI.
- Cloud LIMIT cancellation is wired to the authenticated gateway.
- Signed-in stop-loss/target execution and cloud account reset remain intentionally blocked until server-side implementations exist. Guest-only local simulation remains separate.
- The cloud API URL remains empty in the page metadata until the trusted gateway is deliberately deployed; signed-in trading therefore fails closed before deployment.

## Remaining work before production
1. Create or identify an isolated Supabase staging project/branch and apply the migrations there; verify authenticated account initialization, MARKET BUY/SELL, LIMIT reserve/fill/cancel, portfolio/history and two-user isolation end-to-end.
2. Deploy the trusted gateway only to staging with exact CORS origins, server-only secrets, health checks, operational logging and approved market-data usage; verify the deployed service against staging.
3. Implement server-side stop-loss/target execution and cloud account lifecycle/reset as separate additive, tested increments before enabling those controls for signed-in users.
4. Reconcile guest/local historical data and legacy Firebase records with an explicit import/retention plan. Do not delete or overwrite legacy data during cutover.
5. Audit Paper Investing dependencies separately; do not delete database objects until app-wide references and regression tests prove they are unused.
6. Obtain explicit production migration and deployment approval only after staging evidence and rollback procedures are reviewed.

## Safety
No production database migration has been applied and no gateway deployment has been performed. Existing Firebase/Google Cloud resources and customer data have not been modified.
