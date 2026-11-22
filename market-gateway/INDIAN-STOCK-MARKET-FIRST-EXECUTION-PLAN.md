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

## Current engineering status and next gate

The equity protective-order slice is now implemented in this integration branch:

- A dedicated protective-worker lease and bounded scan/cursor processing are separate from the LIMIT worker.
- The worker validates official NSE/BSE cash-equity instruments, exact quote identity and freshness, owner/position state, and deterministic execution identity.
- Atomic SECURITY DEFINER RPCs create, cancel and fill equity protective orders with row locking, idempotency and reserved-share accounting.
- Worker orchestration tests cover fills, stale quotes, unsupported instruments, expired provider tokens, lease contention and cancellation/fill races.
- The worker remains **opt-in and disabled by default**. The creation API fails closed when it is disabled. This does not establish production availability or guaranteed always-on execution.
- Futures and long-option protective exits remain unsupported and must not be routed through the equity worker.

The next Indian-market cash-equity gate is **Intraday LIMIT lifecycle completion**. The current gateway explicitly rejects `order_type=LIMIT` with `product=INTRADAY`; the SQL submission/fill/cancel functions and scheduled LIMIT worker are Delivery-only. Do not expose or silently accept Intraday LIMIT until the complete lifecycle is implemented.

Acceptance criteria for that increment:

1. Add a forward-only migration; do not edit migrations already recorded remotely.
2. Support INTRADAY BUY cash reservations and SELL share reservations without consuming funds/shares reserved by other orders.
3. Extend the worker with bounded, fair processing and a separate, explicit product/session policy; keep Delivery behavior unchanged.
4. Execute fills atomically under account/order/position locks with idempotency, fresh exact-instrument quotes, reservation release exactly once, and correct Intraday realized-P&L accounting.
5. Define market-session close/expiry behavior for pending Intraday LIMIT orders; no pending intraday order may silently carry into the next session.
6. Cover BUY/SELL, partial reservations, insufficient funds/shares, cancel-vs-fill races, duplicate workers, stale/future quotes, lease expiry, idempotent replay, RLS/tenant isolation and recovery.
7. Keep the UI action disabled until the backend lifecycle and regression tests pass.

After Intraday LIMIT, finish the remaining cash-equity gaps (including charge-aware accounting and complete order/trade-history validation) before moving to futures lifecycle hardening, options lifecycle validation, risk controls and release testing.

The existing Delivery LIMIT worker must not be reused as an Intraday implementation by simply removing its product filter. Its reservation, realized-P&L, session-expiry and cancellation invariants need explicit tests first.
