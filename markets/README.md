# ZENURA IGNITE — Market workspace

## Isolation
- `/markets/` is the market selector.
- `/markets/stocks/` is the independent Indian stock-market workspace.
- `/crypto/` remains the existing crypto application and is linked without modifying its simulator, balances, charts, payment flow, or storage.
- Do not share portfolio collections, local-storage keys, virtual balances, watchlists, or trade history between the two modes.

## Indian market scope
- NSE/BSE cash equities and indices.
- Listed stock/index futures and options, only when present in the current official instrument master and enabled for the account.
- Option chain with CE/PE, expiry, strike, LTP, bid/ask, volume, OI, IV and Greeks where the provider returns them.
- Separate watchlists, charts, paper order engine, virtual balance, positions, P&L and history.
- No placeholder values may be labelled live. When the feed is disconnected, show an explicit unavailable state.

## Selected provider: Upstox Developer API
Use Upstox OAuth 2.0 and Market Data Feed V3. The official V3 feed is WebSocket + Protobuf and documents subscription limits by mode. Use official instrument master files for instrument keys and contract metadata; refresh them on the provider's prescribed schedule. Use the official option-chain endpoint for chain snapshots and V3 streaming for live ticks.

## Required secure implementation before live operation
1. Create an Upstox Developer application and configure the exact OAuth redirect URL.
2. Store client secret and access/refresh tokens only in Firebase Secret Manager / server-side storage. Never put them in GitHub Pages JavaScript, HTML, localStorage, or public Firebase documents.
3. Add server-side OAuth start/callback endpoints with state + PKCE/CSRF validation and token expiry/refresh handling.
4. Add an authenticated market gateway that owns the Upstox WebSocket connection, decodes the V3 Protobuf messages, applies subscription limits, and streams only authorized data to signed-in app sessions.
5. Implement instrument-master ingestion, quote snapshots, historical candles, and option-chain retrieval.
6. Build the independent paper-trading ledger using verified provider quotes, lot sizes, tick sizes, expiry and market-session metadata. Reject orders when quote freshness or contract metadata cannot be verified.
7. Verify provider account entitlements and any required exchange/display/redistribution permissions before exposing market data to other users.

## Current implementation status
This branch adds the mode selector and a non-misleading Indian-market UI shell only. It does not claim to provide live NSE/BSE data or executable paper orders yet. The current repository is GitHub Pages for static files; GitHub Pages cannot host the secure OAuth callback or WebSocket market gateway. Firebase Functions / another server runtime must host those endpoints. Upstox app credentials and account authorization have not been provided, so live feed integration cannot be activated yet.
