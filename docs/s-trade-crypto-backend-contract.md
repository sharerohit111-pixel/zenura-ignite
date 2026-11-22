# S-TRADE Crypto Spot Backend Contract

Status: draft implementation on `feature/s-trade-crypto-supabase-backend-2026-11-22`. This migration has **not** been applied to the Supabase project.

## Scope
- Isolated USDT-denominated simulated spot trading for the existing Binance Spot symbols.
- Supabase Auth UUID ownership; no Firebase UID conversion or legacy account import.
- Separate crypto cash account, positions, orders, and append-only cash ledger.
- Market orders are the only executable order type in this first migration. The schema reserves LIMIT as a data type, but this migration does not implement limit-order reservation/fill/cancel or protective stop/target workers.
- No live exchange order placement or custody.

## Security boundary
- All four tables enable RLS. Authenticated users can read only rows whose `user_id = auth.uid()`.
- Direct client writes are revoked. Mutations go through SECURITY DEFINER functions with an empty search_path, and EXECUTE is granted only to `service_role`.
- A trusted server/Edge Function must authenticate the caller with Supabase Auth, derive the user UUID from the verified JWT (never accept an arbitrary client-supplied user id), validate the Binance symbol and quote against the provider response, calculate fee policy, and then call the service-role RPC.
- Never expose the service-role key in browser code.
- The database enforces a 15-second quote age and 2-second future-clock tolerance as a secondary guard. Timestamp freshness alone is not proof that a price came from Binance; the server must validate source, symbol, price, and timestamp.

## Account initialization
`initialize_paper_crypto_account(user_id, starting_cash_usdt)` creates an account once. A repeated call returns the existing account and cannot reset its balance. The starting USDT amount is deliberately an explicit server configuration input; do not infer it from the INR equity capital without an approved FX/conversion policy.

## Market execution
`execute_paper_crypto_market_order(...)`:
- Locks the account row and existing position row.
- Enforces idempotency by user + idempotency key + request fingerprint.
- Uses fixed-precision NUMERIC arithmetic, not floating point.
- Rejects stale quotes, invalid symbols, insufficient cash, and insufficient sell quantity.
- Updates account, position, order, and ledger atomically in one database transaction.
- Returns simulated-only results.

## Remaining work before production
1. Implement a Supabase Edge Function for verified JWT, Binance quote validation, canonical fee calculation, request fingerprinting, and service-role RPC invocation.
2. Add tests for buy/sell accounting, fee accounting, partial/full exits, duplicate replay, idempotency-key collision, stale/future quote, invalid symbol, insufficient cash/quantity, and cross-user access.
3. Decide the approved USDT virtual starting capital and crypto fee schedule; do not silently reuse the INR ₹10,00,000 allocation.
4. Implement LIMIT order reservation/fill/cancel and server-side stop-loss/target execution as separate tested increments.
5. Wire the crypto UI away from Firebase/localStorage to Supabase Auth and these APIs, preserving Binance chart/feed UI.
6. Review the migration in a disposable Supabase branch/project and run lint + integration tests before applying to production.
