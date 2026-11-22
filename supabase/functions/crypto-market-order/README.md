# Crypto Market Order Edge Function

Function: `crypto-market-order`

## Required Supabase secrets
- `SUPABASE_URL` (normally injected by Supabase)
- `SUPABASE_ANON_KEY` (normally injected by Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never expose to browser)
- `CRYPTO_STARTING_CASH_INR` (approved virtual INR starting balance; must be explicitly configured)
- `CRYPTO_TAKER_FEE_RATE` (decimal rate, e.g. 0.001 for 0.1%; set only after product fee policy is approved)
- `APP_ORIGIN` (exact allowed browser origin)

## Request
POST JSON:
```json
{
  "orderId": "UUID",
  "idempotencyKey": "UUID",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "quantity": "0.001"
}
```

The account starts with ₹10,00,000 virtual INR and uses the existing 0.10% paper fee. The server fetches a USD/INR reference rate and stores it with the simulated INR fill. The browser does not submit execution price, quote timestamp, fee, user id, or fingerprint. The function verifies the Supabase JWT, derives the user UUID, fetches the latest Binance Spot trade server-side, checks quote freshness, calculates the configured fee, and calls the service-role-only database RPC.

## Deployment gate
Do not deploy until the corresponding database migration is applied and tested in a disposable Supabase branch/project. Do not set a guessed starting balance or fee rate. Configure exact CORS origin. The function places no live exchange orders.
