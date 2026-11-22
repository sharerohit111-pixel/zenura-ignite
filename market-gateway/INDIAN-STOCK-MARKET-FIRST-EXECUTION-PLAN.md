# Indian Stock Market first — S-TRADE execution plan

**Decision:** Complete and validate the Indian Stock Market experience before resuming the separate Crypto backend work. This is a sequencing decision, not a deletion or merge decision.

## Repository baseline inspected

- Active integration candidate: `integration/supabase-native-auth-professional-launch-2026-11-22`.
- Indian Stock Market UI is isolated under `markets/stocks/`.
- The stock terminal has independent Upstox OAuth connection controls, instrument search/watchlists, charts and indicators, cash-equity MARKET/LIMIT ticket, portfolio/history, futures, options and margin-preview surfaces.
- The terminal's gateway URL metadata is blank in the checked-in HTML. Live provider requests therefore remain intentionally unavailable until a verified gateway deployment is configured.
- Supabase-native gateway routes currently include account, watchlist, cash-equity MARKET/LIMIT orders and cancellation, portfolio/history, options, futures MARKET orders, futures portfolio/history, and margin preview.
- Futures LIMIT orders are explicitly rejected until the protected LIMIT worker is available.
- The current frontend exposes chart indicators and drawing controls; their complete live-data behavior must be validated against the deployed feed rather than inferred from UI presence.
- The core Supabase migrations are draft-only. The SQL schema uses `auth.users` identities, integer paise, separate Delivery/Intraday equity positions, derivative positions, futures positions/orders, private watchlists and RLS.
- The checked-in compliance note states that public real-time market-data launch is not approved until written provider permission and Indian legal review are obtained. Do not bypass this gate.

## Scope order — Indian market first

1. **Cash equities:** NSE/BSE instrument master, verified quotes/candles, watchlists, charts, indicators, Delivery and Intraday MARKET/LIMIT lifecycle, reservations, cancellation, fills, portfolio valuation, P&L and order/trade history.
2. **Futures:** contract validation, margin preview, MARKET paper execution, charges, margin reservation/release, position lifecycle, expiry handling, portfolio and history. Futures LIMIT remains disabled until a separately tested worker/lifecycle is ready.
3. **Options:** NSE/BSE CE/PE contract validation, long-option BUY and SELL-to-close only, lot/tick/expiry/strike integrity, charges, cash accounting, portfolio valuation and history. Short-option writing remains disabled unless a separately approved risk/margin model is implemented.
4. **Risk controls:** server-side stop-loss/target lifecycle and session-aware controls. Do not describe client-side display controls as guaranteed server execution.
5. **Release validation:** complete CI, staging migration rehearsal, authenticated multi-user isolation, concurrency/idempotency, rollback, observability, mobile/browser regression and provider/legal sign-off.

## Explicit sequencing guardrails

- Do not develop, deploy, merge or apply Crypto-specific changes while Indian-market work is the active priority.
- Keep the separate Crypto draft PR and its branch intact as parked work; do not delete or merge it as part of this sequencing change.
- Do not apply draft migrations to the linked production Supabase project or import/overwrite customer data.
- Do not activate a public real-time feed or production gateway until the documented market-data rights gate is satisfied.
- Do not enable a UI action unless its backend lifecycle and tests exist; fail closed with a clear message instead.
- ZENURA IGNITE has one user-facing mode: Paper Trading. Preserve Indian stock-market and Crypto Paper Trading; Paper Investing is retired.

## Current verified gaps / release blockers

- No staging deployment evidence is recorded in this integration branch's inspected documentation.
- The checked-in stock terminal has an empty gateway URL; deployed endpoint, secrets, CORS and OAuth callback configuration remain to be verified.
- Futures LIMIT is explicitly not enabled.
- Server-side always-on stop-loss/target execution is not evidenced by the inspected stock gateway routes.
- Public real-time market-data rights and legal applicability remain unapproved per `MARKET-DATA-COMPLIANCE.md`.
- Production migration and rollout remain blocked pending reviewed staging evidence, rollback plan and explicit approval.

## Working method

Work only on the Indian-market integration branch and its isolated stock/gateway/migration/test files. Make additive, independently tested changes. After each coherent increment, run targeted tests and the full gateway/CI suite, review the exact diff, and record remaining blockers. Keep Crypto untouched until the Indian-market release gates are met.

## Next engineering gate: protective stop-loss / target worker

The database currently has a private `paper_protective_orders` table. A pure trigger evaluator and unit tests now exist in `market-gateway/lib/protective-order-worker.js`, but the gateway has no leased worker or atomic fill RPC that evaluates and executes these orders. The evaluator is not connected to live execution; a table, helper and UI control do not constitute server-side protection.

Before enabling stop-loss or target execution:
1. Add a dedicated leased worker state key and bounded cursor/batch processing; never reuse the LIMIT worker cursor or lease.
2. Evaluate only ACTIVE orders for supported instruments and verified owner/position state. Validate quote instrument identity, exchange, timestamp freshness, positive integer paise price and market-session policy.
3. Make trigger evaluation deterministic for STOP_LOSS and TARGET using explicit `trigger_direction`; reject malformed combinations and out-of-range quantity/price.
4. Execute fills only through a SECURITY DEFINER RPC with strict service-role-only grants, row locks, idempotency, position quantity checks, paise accounting, fees/taxes, and atomic order/position/history updates.
5. Define partial-fill, gap-through, market-closed, stale-quote, insufficient-liquidity and retry behavior. Never silently mark an order FILLED without an atomic ledger fill.
6. Add concurrency, duplicate-worker, lease-expiry, partial-close, reverse-position, stale/future quote, multi-tenant RLS and crash-recovery tests.
7. Expose health/last-cycle status without leaking user identifiers or provider secrets; alert on repeated failures and lease starvation.
8. Keep the UI/API from advertising guaranteed SL/target execution until the worker is deployed, monitored and end-to-end verified.

The existing LIMIT worker is a useful pattern for leasing and fresh-quote validation, but its DELIVERY-equity-only fill RPC must not be reused for futures/options or protective orders without a separate accounting design.

### Schema-specific findings for the protective-order transaction

Inspection of the current draft migrations adds an important constraint to the design:

- `paper_equity_positions` has `quantity` and `reserved_quantity`, so equity exits can be bounded by held minus already-reserved shares.
- `paper_derivative_positions` stores a positive `net_quantity` for long CE/PE positions, but has no reserved-exit quantity column.
- `paper_futures_positions` stores signed `net_quantity` and `reserved_margin_paise`, but no reserved-exit quantity column. Its `product` values are `INTRADAY` / `DELIVERY`; protective order product labels are `FUTURES`.
- `paper_protective_orders` currently stores trigger and requested quantity, but has no idempotent fill ledger, execution price/quote fields, reservation state, or link to a position version.

Therefore the pure helper's position checks are preflight validation only. They cannot prevent two ACTIVE protective orders from both claiming the same shares/contracts. Before a worker is enabled, the forward migration and atomic RPC must introduce a consistent reservation strategy for equity, futures and long options, or atomically aggregate and serialize all competing ACTIVE protective orders under the relevant account/position lock. The RPC must also create the canonical paper trade/order-history record and release any reservation exactly once on fill, cancellation or rejection.

The inspected futures market-order RPC already handles account locking, margin and position updates, but its contract is a MARKET entry/exit transaction. It must not be invoked as a shortcut for a triggered protective order unless the protective RPC wraps and preserves the same accounting invariants in one transaction. The option position schema is long-only; protective execution must remain SELL-to-close and must never create a short option position.

