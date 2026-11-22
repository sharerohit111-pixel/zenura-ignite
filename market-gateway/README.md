# ZENURA IGNITE — Supabase-native Indian Market Gateway

This is the Node.js 22 market-data and paper-order gateway for the **new ZENURA IGNITE app**. Its default entrypoint is `supabase-server.js`: Supabase Auth verifies user access tokens, Supabase Postgres stores all app account/order/portfolio/watchlist/chart state, and Upstox credentials remain encrypted on the server.

**This app's gateway does not use Firebase Authentication, Firestore, Firebase Admin SDK, or Firebase Functions.** The older `server.js` Firebase implementation remains isolated for legacy/reference purposes and is not the Docker or default npm start target.

## Required runtime configuration

- `SUPABASE_URL`: `https://<project-ref>.supabase.co`.
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (server and browser use the publishable key only for user-scoped access).
- `SUPABASE_SERVICE_ROLE_KEY`: server-only secret used for token verification and narrowly scoped privileged RPCs. Never expose it to the browser or commit it.
- `UPSTOX_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte encryption key held in Secret Manager.
- `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI`: Upstox OAuth credentials and exact callback URL.
- `ALLOWED_ORIGINS`: comma-separated exact HTTPS frontend origins; wildcard origins are not accepted.
- `ZENURA_APP_REDIRECT_URI`: exact HTTPS app return URL after Upstox OAuth; its origin must be in `ALLOWED_ORIGINS`.
- `MAX_INSTRUMENT_KEYS`: stream subscription guardrail (default 100, hard maximum 500).
- `PORT`: Cloud Run supplies this automatically (default 8080 locally).

## Run and verify

```sh
npm install
npm run check
npm test
npm start
```

`npm start` and the Docker image both start the Supabase-native gateway. `npm run worker:limit` runs the isolated scheduled Supabase LIMIT worker as a one-shot process. The legacy Firebase server is not started by default.

## API

- `GET /health`: liveness and instrument-master cache status.
- `GET /instruments?kind=equities|indices|futures|options&q=RELIANCE&exchange=NSE&limit=50`: official Upstox BOD instrument master search.
- `GET /candles?instrument_key=...&unit=minutes&interval=5&to_date=YYYY-MM-DD&from_date=YYYY-MM-DD`: authenticated Upstox historical candles.
- `GET /option-chain?instrument_key=...&expiry_date=current_week`: authenticated NSE/BSE option chain.
- `POST /stream`: authenticated Upstox V3 WebSocket-to-SSE bridge; user token required.
- `GET /upstox/connection`, `POST /upstox/oauth/start`, `GET /upstox/oauth/callback`, `DELETE /upstox/connection`: secure Upstox OAuth lifecycle.
- `GET /watchlists`, `GET /watchlist?name=...`, `GET /watchlist/quotes?name=...`, `PUT /watchlist`: per-user watchlists and quote refresh.
- `GET /paper/account`, `POST /paper/orders`, `POST /paper/orders/:orderId/cancel`, `GET /paper/orders`, `GET /paper/portfolio`: Paper Trading cash-equity account, market/limit order and portfolio routes.
- `POST /paper/derivative/margin-preview`, `POST /paper/derivative/orders`, `GET /paper/derivative/orders`, `GET /paper/derivatives/portfolio`: long CE/PE options and futures margin preview. Futures order support is described by the futures endpoints below.
- `POST /paper/futures/orders`, `GET /paper/futures/orders`, `GET /paper/futures/portfolio`: futures paper orders and portfolio.
- `GET /paper/investing/account`, `POST /paper/investing/orders`, `GET /paper/investing/orders`, `GET /paper/investing/portfolio`: independent Paper Investing virtual cash, positions and history.

All private endpoints validate the Supabase access token. User-facing reads/writes use the user's Supabase session and RLS; server-side service-role access is limited to authentication, secure token storage/coordination and explicitly allowlisted RPCs. All orders are paper simulations: no broker/exchange order is sent. The gateway never sends the Upstox access token to the browser.

## Security and operating boundaries

- No Firebase identity, Firestore UID mapping, old customer import or legacy account reconciliation is part of this app.
- Supabase service-role and Upstox secrets must exist only in Cloud Run Secret Manager.
- Browser requests use Supabase publishable key plus the signed-in user's access token; RLS remains mandatory.
- Exact-match instrument validation, fresh provider quote checks, idempotency keys and transactional Postgres RPCs protect paper-order execution.
- The Supabase LIMIT-order worker is a separate Cloud Run Job. It uses a Postgres lease/single-writer guard, fresh Upstox batch quotes and the transactional `execute_paper_limit_fill` RPC; do not run multiple worker tasks in parallel.
- Upstox OAuth access tokens expire on the provider's daily schedule; the app must prompt users to reconnect when expired.
- The public `/instruments` and `/health` endpoints contain no private account data. All account, portfolio, order and stream endpoints require Supabase authentication.
- Configure exact CORS origins and verify the Upstox developer-console callback URL matches `UPSTOX_REDIRECT_URI` byte-for-byte.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Supabase + Cloud Run deployment runbook.
