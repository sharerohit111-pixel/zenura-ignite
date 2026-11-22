# ZENURA IGNITE — Supabase-native Professional Launch Scope

Status: active implementation baseline; this document supersedes conflicting Firebase-customer-migration assumptions for the new ZENURA IGNITE app.
Repository: `sharerohit111-pixel/zenura-ignite`
Supabase project: `atvbjibhunvzpmfagagm` (Mumbai / ap-south-1)
Working baseline: existing migration-validation work from PR #81, preserved for review.

## 1. Product goal

Deliver the existing ZENURA IGNITE application as a professional, fast, reliable Android/web platform with exactly two user-facing modes:

1. **Paper Trading** — Indian cash equities, futures and options.
2. **Paper Investing** — a separate long-term investing experience.

This is not a new application and is not a rewrite from zero. Reuse and improve the existing market terminal, order workspace, portfolio/history, watchlists, quote streaming, Upstox integration, transaction logic and tests wherever they pass review.

Branding remains:
- ZENURA IGNITE
- Paper Trading & Paper Investing
- Powered by ZENURA IGNITE Technologies
- Rohit Kumar — Founder & Developer

No live broker orders are ever submitted. All orders are simulated.

## 2. Explicitly out of scope

- No migration, import, restore, reconciliation, UID mapping or retention of old Firebase customer accounts or customer trading data.
- No Firebase Authentication or Firestore as the new app's user identity or trading database.
- No destructive changes to the existing Firebase project, Cloud Run service, old app or its data.
- No unrelated Railway Mitra work.
- No activation of subscriptions at initial launch.
- No reintroduction of the removed three practice levels or removed research-only Investing Mode.

There are no existing customers to migrate. New registrations must be native Supabase Auth users.

## 3. Target platform architecture

### Identity and application data
- Supabase Auth is the only user authentication provider for the new app.
- Use Supabase Auth user UUIDs directly (`auth.uid()`) as the owner key for all user-owned rows.
- Remove Firebase UID mapping and Firebase third-party JWT assumptions from the new-app launch path.
- Supabase Postgres is the source of truth for accounts, orders, fills, positions, reservations, watchlists, investing ledger, preferences and histories.
- RLS is mandatory for every user-owned table. Browser clients receive only the minimum required privileges.
- Trading writes, privileged account initialization, market-data credential handling and worker operations execute through a trusted server runtime. Never ship a service-role key to the browser or Android package.
- Use idempotent server-side transaction functions; do not let clients directly edit balances, fills, positions, average costs or realized P&L.

### Market data and runtime
- Retain the existing Upstox V3 market-data work where valid: official instrument master, quote validation, WebSocket decoding, SSE fan-out, reconnect/backpressure, quote freshness and encrypted token handling.
- The long-lived upstream WebSocket/SSE gateway remains a separately deployed container-capable service. Supabase Edge Functions are not a substitute for a persistent upstream WebSocket process.
- Replatform user identity, OAuth state, encrypted connection records, stream leases, worker state and paper-trading persistence away from Firebase/Firestore into Supabase/private server-side storage.
- Keep provider secrets and token-encryption keys in server-side secret storage only.
- Do not shut down or modify the old Firebase/Cloud Run deployment until the new runtime has passed staging, load, reconnect, rollback and acceptance tests.

## 4. Market coverage

Instrument discovery must use the current official provider instrument master, not a hard-coded small symbol list.

- NSE and BSE listed cash-equity instruments available from the selected provider.
- Available indices.
- Available stock and index futures, including expiry, lot size, tick size and contract validation.
- Available stock and index options: CE and PE contracts, expiry, strike, lot size, tick size and option-chain fields.
- Search, filtering, watchlists, instrument switching and stale/unavailable-data states.
- Refresh and validate instrument master on a controlled schedule; retain last-known-good data and reject malformed or stale masters.

The UI must not claim universal exchange coverage where the market-data provider does not supply a symbol, segment, historical range or entitlement. Show provider coverage/availability clearly.

## 5. Paper Trading requirements

- ₹10,00,000 initial virtual cash for each new Paper Trading user.
- Intraday and Delivery cash-equity modes.
- MARKET and LIMIT order lifecycle, cancellation, reservations, fills, partial fills only if the simulator explicitly supports them, and immutable order history.
- Stop-loss and target orders with deterministic trigger, gap/slippage and race-condition rules.
- Futures long/short simulation with exchange lot/tick/expiry validation, margin reservation, mark-to-market, risk checks, square-off and expiry handling.
- Options CE/PE simulation with option-chain selection, premium orders, position lifecycle, risk/margin controls for any short-option capability, and expiry/settlement handling.
- Shared-account or separate-product ledger semantics must be explicitly documented and tested; never silently duplicate or reset virtual capital.
- Charges, taxes and statutory fee model must be versioned, transparent and covered by boundary tests.
- Prevent double fills, double debits, overselling, negative available cash, duplicate worker execution and cross-user access.
- Portfolio valuation must distinguish fresh, stale and unavailable quotes.

Existing schema/RPC work for cash equity, LIMIT reservations and long CE/PE is a starting point only. It is not proof that futures execution, short derivatives, stop-loss/targets or complete investing behavior already exist.

## 6. Paper Investing requirements

- A distinct user-facing mode and ledger from active Paper Trading, with clear balances and performance history.
- Long-term stock/fund investment workflows supported by the actual product scope and provider instruments.
- Buy/sell, holdings, average cost, realized/unrealized P&L, dividends/corporate-action treatment where supported, and portfolio history.
- No mixing of Paper Investing balances or holdings with Intraday, Delivery or F&O trading balances unless an explicit tested product rule says otherwise.
- Preserve the existing two-mode product decision; do not add a third research/investing mode.

## 7. Professional charting requirements

The existing chart panel and theme control are retained as the UI starting point, but the current SVG close-price plot is not considered a finished professional chart engine.

Deliver a dedicated, maintained chart module with:
- Candlestick, OHLC/bar, line and area display.
- Smooth pan/zoom, crosshair, price/time scales, visible-range controls and responsive resizing.
- Intraday and historical intervals supported by the provider.
- Volume and indicator panes/overlays.
- Drawing tools: trendline, horizontal/vertical line, ray, channel/parallel channel, Fibonacci retracement/extension, rectangle, circle, text, arrows and measurement tools.
- Edit, move, resize, hide/show, lock, delete, undo/redo and persisted user drawings/templates.
- Indicators: SMA, EMA, WMA, VWAP, RSI, MACD, Stochastic, Bollinger Bands, ATR, ADX, Supertrend, Ichimoku, Volume, OBV, MFI and CCI, with configurable parameters and visibility.
- Multiple chart layouts, symbol switching, full-screen mode, saved chart settings and dark/light chart appearance.
- Clear empty, loading, stale-data, reconnecting and provider-error states. Never draw fabricated candles or label delayed quotes as live.

Select a chart library only after verifying its license, mobile support, rendering performance, accessibility, data API and compatibility with the current static frontend. Do not use a toy SVG/polyline as the final chart.

## 8. Performance and reliability bar

Performance is a release requirement, not a cosmetic enhancement:
- Keep initial page/app startup and navigation lean; lazy-load heavy chart/indicator modules.
- Avoid full DOM rebuilds for every tick; batch/coalesce quote updates and update only affected series/rows.
- Use bounded caches, request cancellation, sequence guards, backpressure and reconnect jitter.
- Avoid unbounded subscriptions, timers, listeners, memory growth and duplicate WebSocket streams.
- Use database indexes, bounded pagination and measured query plans.
- Add load tests for concurrent users, active streams, instrument switching, chart history and simultaneous order submissions.
- Measure startup, interaction latency, chart frame stability, memory, API p50/p95, reconnect recovery and database contention on representative Android devices.
- Set numeric release thresholds after establishing a reproducible baseline; do not claim “zero lag” without measurements.

## 9. Existing work to preserve and audit

Preserve and inspect before changing:
- `markets/stocks/index.html`, `stocks.js`, `stocks.css`.
- `order-workspace.js` and its CSS/tests.
- `connect.js`, `email-auth.js` as UI/auth-flow references only; replace Firebase auth implementation with Supabase Auth.
- Upstox V3 feed decoder, instrument master, quote freshness, stream lifecycle, SSE and reconnect modules.
- Cash-equity transaction, idempotency, LIMIT reservation and charge logic.
- Derivative contract, long-option transaction, portfolio and margin-preview logic.
- Existing tests and Supabase migration/RPC drafts.

Classify each module as KEEP, UPGRADE, REPLACE or NOT IN LAUNCH SCOPE. Do not delete old Firebase files or change old deployments merely to isolate the new app.

## 10. Existing draft PR handling

- PR #81 contains useful draft SQL/RPC work and extensive disposable-Postgres tests, but its Firebase UID identity map and Firebase-customer export/reconciliation work are not part of the new-app launch path. Reuse the valid transactional work after converting ownership to native Supabase Auth.
- PR #82 read transport is explicitly Firebase-token/identity-adapter based and must not be wired into the new app. Build native Supabase Auth transport instead.
- Both PRs remain drafts and must not be merged as-is.
- Existing SQL smoke tests used disposable PostgreSQL, not live Supabase certification.
- The live Supabase project was inspected: no public application tables were present and only the existing RLS-trigger safety migration was recorded. Do not apply the draft schema directly to production before staging and security validation.

## 11. Required implementation sequence and acceptance gates

1. Complete repository inventory and route/UI/backend feature matrix.
2. Convert schema ownership and RLS to native Supabase Auth; remove customer-import assumptions from launch.
3. Implement and test Supabase Auth session lifecycle and server-side JWT verification.
4. Complete Supabase database/RPC for cash equity, LIMIT worker, stop-loss/targets, futures, options, investing ledger and watchlists.
5. Replatform Upstox OAuth/token lifecycle, market stream leases and worker state to private Supabase-backed storage.
6. Integrate existing frontend screens with native Supabase Auth and trusted backend APIs.
7. Replace the placeholder SVG chart with the selected professional chart engine and implement indicators/drawing persistence.
8. Add performance/load/security/concurrency/failure-recovery tests.
9. Run Android device testing, accessibility checks, release signing and Play Store policy checklist.
10. Only after all gates pass, prepare the production cutover and Play Store release. Do not publish or alter production settings without an explicit release approval.

## 12. Definition of done

The app is not launch-ready until both modes work end-to-end with real provider market data, native Supabase Auth, isolated per-user data, complete order/position accounting, futures/options risk controls, professional charts, reliable reconnects, measured performance, tested Android release build and a documented rollback plan.
