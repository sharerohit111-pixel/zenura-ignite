# Paper Trading Firebase → Supabase route cutover matrix

## Purpose

This is a static source-code cutover map for the existing Indian Paper Trading service. It prevents the database migration from being treated as complete merely because the schema, transformer, or identity adapter tests pass. It does not change runtime routing or authorize a production cutover.

## Current verified source-code state

- `market-gateway/server.js` still authenticates with Firebase and reads/writes Firestore for active Paper Trading routes.
- `market-gateway/lib/supabase-paper-identity.js` is an isolated adapter. Its own design note says it is not wired into active routes.
- The adapter's tests are synthetic. No real Firebase ID token was used and no live Supabase identity RPC was called.
- The live Supabase project currently has no public Paper Trading tables deployed (see the read-only project check recorded in the migration work log).
- This is a source-code audit only. It does not establish which Cloud Run revision, Firebase Functions deployment, worker flag, or live traffic path is currently active.

## User-facing Paper Trading route matrix

| Route / capability | Current implementation observed in source | Supabase target / migration gate |
|---|---|---|
| `GET /paper/account` | Firebase-authenticated Firestore account initialization/read | Resolve Firebase UID to private Supabase UUID; use the account initialization RPC; prove exactly one shared ₹10 lakh virtual account per user, no duplicate initialization |
| `POST /paper/orders` MARKET | Firestore account + order transaction; exact Upstox quote is fetched server-side | Use `execute_paper_market_order`; preserve idempotency, cash/position atomicity, quote timestamp, server-computed price and exact instrument validation |
| `POST /paper/orders` LIMIT | Firestore reservation transaction | Use `submit_paper_limit_order`; preserve reservation, tick-size, idempotency and cancel/fill race semantics |
| `POST /paper/orders/:orderId/cancel` | Firestore cancellation transaction | Use `cancel_paper_limit_order`; preserve owner checks and reservation release |
| `GET /paper/portfolio` | Firestore account/positions plus server-fetched Upstox quotes | Read user-scoped Supabase account/position rows under RLS; quote retrieval stays server-side |
| `GET /paper/orders` | Firestore order history with UID filter and cursor pagination | Read `paper_orders` under RLS; preserve stable pagination and legacy order identifiers |
| `POST /paper/derivative/orders` | Firestore account + derivative order transaction; server-fetched Upstox quote | Use `execute_paper_long_option_order`; preserve shared cash account, CE/PE contract checks, charges, strike-price history and idempotency |
| `GET /paper/derivatives/portfolio` | Firestore derivative positions plus server-fetched Upstox quotes | Read `paper_derivative_positions` under RLS; keep provider quote acquisition server-side |
| `GET /paper/derivative/orders` | Firestore derivative history with UID filter | Read `paper_derivative_orders` under RLS; preserve pagination and ownership |
| `GET/PUT /watchlists`, `GET /watchlist` | Firestore per-UID watchlist document | Read/write `paper_watchlists` under user-scoped RLS; preserve named-list shape, limits and legacy list compatibility |

The identity adapter currently allowlists the five user-scoped RPCs: account initialization, MARKET order, LIMIT submit, LIMIT cancel, and long-option order. Read paths and watchlist CRUD still need a separately reviewed RLS-backed transport or narrowly scoped RPC design. Do not route general table access through a service-role key.

## Keep broker credentials and market operations separate

The existing gateway and Firebase Functions also use Firestore for Upstox OAuth/token envelopes and operational state. These are not part of the four-collection Paper Trading export:

- `upstoxConnections`: encrypted broker-token envelope and expiry/status.
- `upstoxOAuthStates`, `upstoxConnectionControls`: OAuth replay protection and connection-generation control.
- `indianMarketStreamLeases`, `indianMarketWorkerState`: market-feed and worker coordination.
- `indianMarginPreviewLimits`: margin-preview rate limiting.

Do not export broker tokens, OAuth state, encryption keys, or payment-provider data as part of the Paper Trading account migration. Keep the existing Upstox quote fetches server-side and preserve the fixed provider endpoint, authenticated request, exact instrument-token match, price validation, timestamp freshness and no-store response behavior.

## Critical scheduled LIMIT worker dependency

Static source review found `functions/indian-market.js` exports `processPendingPaperLimitOrders` as a Firebase scheduled function. It fetches Upstox quotes and processes pending LIMIT orders against Firestore. The worker is gated by `ZENURA_ENABLE_PAPER_LIMIT_WORKER === "true"`; the repository runbook says it must remain disabled until separately approved.

This worker is a trading-data writer, not merely an operational helper. Before moving LIMIT orders/accounts to Supabase, one of these must be completed and tested:

1. Port the worker to a Supabase-compatible server-side worker that performs fills/cancels through the same atomic Supabase transaction boundary; or
2. Keep LIMIT functionality explicitly unavailable during the cutover until that worker is ready.

Never allow the Firebase worker and Supabase API to mutate the same logical orders/accounts in parallel. Verify the deployed worker state from the actual Firebase project before cutover; repository configuration alone cannot prove whether it is deployed or enabled.

## Mandatory sequence before any cutover

1. Confirm the live Firebase project is `zenura-ignite-technologies` using authorized read-only access; verify the deployed Cloud Run service/revision and Firebase Functions.
2. Inventory top-level collections and all subcollections in the live source. The current exporter does not recurse into subcollections.
3. Complete a quiescence or watermark/dual-read consistency plan; the current exporter is not a transactionally consistent snapshot.
4. Provision and independently verify the UID → UUID identity map. Confirm the Firebase JWT third-party integration and approved `role: authenticated` claim rollout. No claims have been changed.
5. Deploy the ordered Supabase schema to a staging project only after approval; test real Firebase-token identity resolution, RLS reads, all write RPCs, pagination, watchlists, idempotency, concurrency, and rollback.
6. Complete the LIMIT worker decision and verify no dual writers remain.
7. Run export → offline transform → dry-run reconciliation; investigate every missing, duplicate, orphaned, or hash-mismatched record.
8. Rehearse backup, rollback and a measured cutover window. Production deployment/import requires separate explicit approval.

## Explicit non-actions

This document does not wire the adapter into Express routes, deploy migrations, export Firebase data, modify custom claims, alter OAuth settings, deploy/enable the scheduled worker, or switch application traffic. Existing Firebase/Firestore routes remain unchanged.
