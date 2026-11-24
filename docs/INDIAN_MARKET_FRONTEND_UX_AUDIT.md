# Indian Market Trading Frontend UX Audit

Audit baseline: `feature/nse-options-accounting-complete-chat6-2026-11-24` (stacked on the current Supabase-native Indian Market integration work).

## Scope boundary

- NSE/BSE Equity, Futures and long CE/PE Options Paper Trading only.
- No Crypto code, routes, schemas, configuration, tests or deployment changes.
- No Paper Investing surface.
- No production migration, deployment, merge or feature activation.

## Existing user-facing screens and actual API wiring

| Screen / flow | Frontend integration | Current behavior / boundary |
|---|---|---|
| Equity order ticket | `GET /paper/account`, `POST /paper/orders` | MARKET and LIMIT; DELIVERY / INTRADAY; idempotent submission handling |
| Equity order book | `GET /paper/orders`, `POST /paper/orders/:orderId/cancel` | Authenticated history, cursor pagination, pending LIMIT cancellation |
| Equity trades | Filled records from authenticated order history | Does not synthesize trades locally |
| Equity holdings / P&L | `GET /paper/portfolio?product=...` | Fresh quote valuation; stale positions are explicitly withheld from aggregate totals |
| Futures MARKET ticket | `POST /paper/futures/orders` | Fresh quote and conservative margin estimate; market-only execution |
| Futures LIMIT ticket | `GET /health`, `POST /paper/futures/limit-orders`, `GET /paper/futures/limit-orders`, `POST /paper/futures/orders/:id/cancel` | Feature/worker readiness gates; cancel pending or partially filled orders |
| Futures positions / history | `GET /paper/futures/portfolio`, `GET /paper/futures/orders` | Separate Futures valuation and margin display; stale quote state is explicit |
| Options MARKET CE/PE | `POST /paper/derivative/orders` | Long CE/PE BUY and SELL-to-close; contract selected from option chain |
| Options LIMIT | `GET /health`, `GET /instruments`, `POST /paper/derivative/limit-orders`, `GET /paper/derivative/limit-orders`, `DELETE /paper/derivative/limit-orders/:id` | Feature-gated; long-only reservation and fresh executable-depth fill policy |
| Options positions / accounting | `GET /paper/derivatives/portfolio`, derivative MARKET and LIMIT history, `GET /paper/account` | Available balance, blocked premium, invested premium, P&L, charges and exit reservations; some totals are explicitly latest-100-history-derived |
| Option chain / market data | `GET /option-chain`, authenticated quote/stream routes | Provider-backed data only; stale/unavailable state must not be presented as live |

All private requests use the signed-in user's bearer token. Frontend state is cleared on authentication changes in the existing market module. Order submission paths use persisted idempotency keys and verify server responses before reporting success.

## Confirmed gaps

1. **Atomic pending-order modification is not implemented.** No authenticated modify endpoint/RPC was found for Equity, Futures or Options LIMIT orders in the audited gateway contracts. The frontend therefore exposes cancellation only. A cancel-and-replace flow is not equivalent to modify: it can race a fill, release/re-reserve funds, change queue priority and create a second order. Do not add a fake Modify button or claim modification support until a server-side atomic contract exists.
2. **Market orders are terminal execution requests.** They should not offer modify/cancel controls after a verified fill. A pending response, if any, must be represented from its server status rather than inferred locally.
3. **Equity order history has cursor pagination; Futures and Options LIMIT history are bounded first-page reads in the audited screens.** Longer histories need server keyset pagination before claiming complete lifetime history.
4. **Options accounting UI explicitly derives blocked premium and recent realized P&L/charges from the latest 100 records.** It must retain that limitation until a lifetime aggregate read model is exposed; never relabel those values as lifetime totals.
5. **Options MARKET quantity entry now uses an inline in-page lots field** instead of a browser prompt. The selected chain contract, expiry and account are still revalidated at submit time; idempotent retry behavior remains required.
6. **Hindi translation coverage was incomplete for the newer Futures LIMIT, Options LIMIT and Options accounting surfaces.** This change adds dictionary entries for those panels and their core statuses/labels. Dynamic messages not present in the dictionary remain English and should be added as exact source strings as their UX is finalized.
7. **Release readiness is separate from UI completeness.** Worker feature flags, staging verification, authorized provider account/data rights and compliance approval remain independent gates. A rendered ticket does not mean the worker is deployed or active.

## Required backend contract before adding Modify

A future modify operation must be a single authenticated server transaction, not a browser cancel-and-replace sequence. It should:

- accept only owner-bound pending/partially-filled LIMIT orders;
- preserve the immutable original order identity and append an auditable modification event/version;
- serialize with worker fill and cancellation under the same account → order → position/reservation lock order;
- revalidate instrument, session/expiry, tick/lot, fresh executable quote/depth and remaining quantity;
- atomically adjust cash/margin/share/close-quantity reservation for the unfilled remainder;
- preserve already executed fills and cumulative charges/P&L;
- use idempotency for uncertain client retries;
- return the canonical order, fills, remaining quantity, reservation delta and terminal/pending status;
- have owner-isolation, concurrent modify-vs-fill, modify-vs-cancel, replay and ledger-reconciliation tests.

Only after that contract exists should the UI show Modify for eligible pending LIMIT orders.

## Verification boundary

This is a source-level audit and translation coverage update. It is not a live browser/staging test, worker deployment, provider entitlement approval, production migration, merge or release certification.
