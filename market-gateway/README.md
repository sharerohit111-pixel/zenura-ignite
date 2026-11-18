# ZENURA IGNITE — Indian Market Gateway (Cloud Run)

This service is a separate long-lived gateway for Upstox Market Data Feed V3. It is not deployed by Firebase Functions.

## Environment
- `UPSTOX_TOKEN_ENCRYPTION_KEY`: same base64-encoded 32-byte key used by Firebase Functions.
- `MAX_INSTRUMENT_KEYS`: per-browser-session guardrail (default 100; must remain within provider limits).
- `ALLOWED_ORIGINS`: comma-separated exact HTTPS origins allowed to call the gateway, e.g. `https://zenuraignite.com`; do not use `*`.
- Cloud Run service account must have Firestore read access to `upstoxConnections` only as required.

## Deploy
Build and deploy this directory as a Cloud Run service. Set ingress/auth policy to allow the public HTTPS endpoint because Firebase ID token validation is performed in the service. Never disable application authentication. Set `UPSTOX_TOKEN_ENCRYPTION_KEY` from Secret Manager, not source control.

## API
- `GET /health`: service health and instrument-master cache status.
- `GET /instruments?kind=equities|indices|futures|options&q=RELIANCE&exchange=NSE&limit=50`: filtered search from the official Upstox BOD JSON instrument master. Uses the provider's `instrument_key`, refreshes the in-memory cache every six hours, and returns at most 100 results.
- `POST /stream`: Authorization: Bearer <Firebase ID token>; JSON body `{"instrumentKeys":["NSE_INDEX|Nifty 50"],"mode":"ltpc"}`; responds with Server-Sent Events containing decoded V3 protobuf messages.
- `GET /candles?instrument_key=...&unit=minutes&interval=1&to_date=YYYY-MM-DD&from_date=YYYY-MM-DD`: authenticated historical OHLC proxy using Upstox Historical Candle V3. `from_date` is optional. The gateway validates unit/interval/date inputs and confirms the instrument key exists in the current official instrument master before requesting provider data. Provider access tokens remain server-side; responses are private/no-store.
- `GET /option-chain?instrument_key=...&expiry_date=current_week`: authenticated Upstox option-chain proxy. Supports an exact `YYYY-MM-DD` expiry or Upstox relative expiry keywords (`current_week`, `next_week`, `far_week`, `current_month`, `next_month`, `far_month`). Only verified NSE/BSE cash-equity and index underlyings are accepted. Response remains private/no-store.
- `GET /watchlists`, `GET /watchlist?name=...`, `GET /watchlist/quotes?name=...`, and `PUT /watchlist`: authenticated, per-user named watchlists (My Stocks, Banking, NIFTY, F&O), up to 50 unique instrument keys per list, verified against the official instrument master. Legacy single-list data is read as My Stocks and preserved through the first named-list save. Data is stored privately by Firebase UID.
- `GET /watchlist/quotes`: authenticated batch quote refresh for the signed-in user's saved watchlist. Returns only exact instrument-token matches with last price and provider net-change; quotes older than 60 seconds or without a valid last-trade timestamp are marked stale/unavailable, never presented as current.
- `GET /paper/account`: initializes/returns the authenticated user's isolated Indian-market virtual account. Requires `INDIAN_PAPER_STARTING_CASH_PAISE` to be explicitly configured; no assumed starting balance.
- `POST /paper/orders`: server-priced market BUY/SELL simulation for verified NSE/BSE cash equities only. The gateway fetches the provider Full Market Quote itself, matches the returned `instrument_token` exactly to the requested instrument key (never falls back to another symbol's quote), and rejects quotes older than 15 seconds. Position quantities and stored balances are validated against safe integer and configured simulation limits. Cash, weighted-average position cost, and realized P&L update atomically in a Firestore transaction. No broker order is submitted. Body: `{"instrument_key":"NSE_EQ|...","side":"BUY","quantity":1}`.
- `GET /paper/portfolio`: authenticated holdings valuation using Upstox Full Market Quotes V3. Returns market value, unrealized P&L and equity; positions without quotes no older than 60 seconds are marked stale and excluded from valuation totals.
- `GET /paper/orders?limit=50`: authenticated user's simulation-only order history.

The gateway obtains the encrypted token for the authenticated Firebase UID, decrypts it in memory, requests the V3 authorized WebSocket URL, subscribes only to requested keys, and streams decoded events to that authenticated client. No Upstox access token is sent to the browser.

## Important limits and operations
The default 100-key per-session guardrail is intentionally conservative and is not a substitute for provider-account-wide subscription accounting. Implement a shared per-user connection/subscription coordinator before production scale-out: Upstox documents limits across all connections for the user. Cloud Run instance scaling can otherwise exceed those limits. Configure concurrency/max instances and monitor active streams. The stream has a server-side heartbeat; the browser currently needs a reconnect/backoff policy. Add token refresh/reconnect, instrument-master ingestion, rate limiting, and entitlement policy before public production use. The historical candle endpoint is wired to the chart interval controls and OHLC chart UI, and the option-chain endpoint is wired to the expiry selector and CE/PE table. Neither has been live-tested against an authorized Upstox account.

The official V3 feed uses binary protobuf messages; the checked-in schema is synchronized from Upstox's maintained SDK example. The official instrument documentation recommends JSON BOD files and `instrument_key`; the gateway downloads the published complete JSON gzip file and never substitutes hand-written symbol lists.

Set `ALLOWED_ORIGINS` to the exact deployed frontend origin. The service intentionally rejects CORS preflights from other origins. The `/instruments` route is public reference metadata; live feed, candles, option chain and paper-trading routes require a valid Firebase ID token and an Upstox connection for that same UID. Set `INDIAN_PAPER_STARTING_CASH_PAISE` explicitly (e.g. 100000000 means ₹10,00,000) before enabling paper accounts. Firestore rules deny all direct client access to `upstoxOAuthStates`, `upstoxConnections`, `indianPaperAccounts`, `indianPaperOrders`, and `indianMarketWatchlists`; the gateway and Firebase Functions use server-side Admin SDK access only. The current simulator supports cash equities and market orders only; limit orders, F&O, fees/taxes, dividends, and corporate actions are not implemented. Portfolio unrealized P&L uses fresh full-market quotes and stale positions are excluded.
