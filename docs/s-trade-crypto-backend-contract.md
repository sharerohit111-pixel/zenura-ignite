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
- No live exchange order placement, custody, deposits, or withdrawals.

## Server runtime
The existing `market-gateway/supabase-server.js` is the canonical server API. It exposes:
- `GET /crypto/account` — idempotently initializes and reads the user's INR paper account.
- `POST /crypto/orders` — accepts symbol, side, quantity and idempotency key; verifies the Supabase session, fetches Binance trade + INR reference rate server-side, calculates the existing 0.10% fee, then invokes the transactional RPC.
- `GET /crypto/portfolio` — reads the authenticated user's cash account, positions and recent order history.

The browser must never submit or control the user UUID, execution price, quote timestamp, FX rate, fee, or request fingerprint. The gateway derives the user from the verified Supabase Auth JWT. The service-role key remains server-only.

## Database security and accounting
- All four tables enable RLS. Authenticated users can read only rows where `user_id = auth.uid()`.
- Direct client writes are revoked. Mutations go through SECURITY DEFINER functions with an empty search_path; EXECUTE is granted only to `service_role`.
- The database enforces a 15-second quote age and 2-second future-clock tolerance as a secondary guard.
- The RPC locks the account and position, enforces idempotency, uses fixed-precision NUMERIC arithmetic, and updates account, position, order and ledger atomically.
- Buy cost basis includes the fee. Sell realized P&L deducts the sell fee and allocates cost basis proportionally for partial exits.

## Remaining work before production
1. Wire Crypto Terminal to Supabase Auth and the gateway; keep existing Binance chart/feed behavior.
2. Add automated tests for buy/sell accounting, fee accounting, partial/full exits, duplicate replay, idempotency-key collision, stale/future quote, invalid symbol, insufficient cash/quantity and cross-user access.
3. Test SQL compilation and RLS in a disposable Supabase branch/project before production application.
4. Implement LIMIT order reservation/fill/cancel and server-side stop-loss/target execution as separate tested increments.
5. Remove Firebase/localStorage trading persistence only after cloud cutover and guest-data behavior are explicitly preserved.
6. Audit Paper Investing dependencies separately; do not delete database objects until app-wide references and regression tests prove they are unused.

## Safety
No production database migration has been applied and no existing Firebase/Google Cloud resources or customer data have been modified.
