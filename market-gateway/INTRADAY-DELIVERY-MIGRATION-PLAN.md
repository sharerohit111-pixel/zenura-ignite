# Cash-Equity Intraday / Delivery Separation Plan

Status: design-only; no runtime behavior changes are made by this document.
Scope: ZENURA IGNITE Paper Trading cash equities only. Paper Investing is out of scope.
Safety: production deployment and the scheduled LIMIT matcher remain disabled.

## Existing behavior verified on the integration branch

- Cash-equity holdings are stored in `indianPaperAccounts/{uid}.positions`, keyed by Upstox instrument key.
- `reservedPositions` tracks pending LIMIT SELL share reservations against that single positions map.
- Available virtual cash is shared and reduced by reserved LIMIT BUY cash and derivative margin reservations.
- MARKET fills call `buildPaperOrderUpdate`; pending LIMIT fills release their reservation and then call the same accounting helper.
- Portfolio valuation reads the single `positions` map. Account normalization exposes that same map.
- Order idempotency fingerprints currently distinguish MARKET from LIMIT, but have no product-mode dimension.
- Existing persisted orders do not carry a cash-equity product mode.

## Proposed account schema

Keep cash shared between the two cash-equity modes. Split only holdings, share reservations, and realized-P&L attribution:

| Field | Meaning |
| --- | --- |
| `positions` | Delivery holdings; retain this existing field for backward compatibility |
| `reservedPositions` | Delivery shares reserved by pending LIMIT SELL orders |
| `intradayPositions` | Intraday holdings |
| `intradayReservedPositions` | Intraday shares reserved by pending LIMIT SELL orders |
| `realizedPnlPaise` | Aggregate realized cash-equity P&L, retained for existing consumers |
| `deliveryRealizedPnlPaise` | Delivery realized P&L attribution |
| `intradayRealizedPnlPaise` | Intraday realized P&L attribution |

The aggregate realized P&L must equal the sum of the two mode totals for accounts created or updated after migration. A migration must not rewrite or guess historical attribution: initialize legacy Delivery realized P&L from the existing aggregate and Intraday realized P&L to zero.

Cash, reserved cash, derivative margin, and starting capital remain shared. Do not create a second ₹10,00,000 cash balance for each mode.

## Product mode contract

- API accepts `product: "DELIVERY" | "INTRADAY"`; omitted product means `DELIVERY`.
- Persist normalized `product` on every new cash-equity MARKET and LIMIT order.
- Persisted orders missing `product` are interpreted as `DELIVERY`.
- Only the server selects account maps. Never trust client-supplied balances, holdings, or reservations.
- The frontend selection is a request preference only; the server remains authoritative.
- Validate product before generating the idempotency fingerprint or entering a transaction.

## Backward-compatible idempotency

Preserve the exact existing fingerprint payload for Delivery requests, including legacy retries:
- MARKET Delivery: existing `{instrumentKey, side, quantity}` payload unchanged.
- LIMIT Delivery: existing `{instrumentKey, side, quantity, orderType, limitPricePaise}` payload unchanged.
- Intraday requests add `product: "INTRADAY"` to the fingerprint payload.
- Old stored orders with no product are treated as Delivery.
- Add tests proving a retry of a pre-upgrade Delivery order still replays, while the same key used for Intraday is rejected.

## Transaction and reservation requirements

1. Extend the shared fill/accounting helper to select the product-specific holdings and share-reservation maps.
2. MARKET BUY/SELL updates only the selected product map and that mode's realized-P&L attribution; update aggregate realized P&L atomically.
3. Pending LIMIT BUY continues reserving shared cash. Pending LIMIT SELL reserves shares only in the selected product map.
4. LIMIT cancellation releases the reservation from the exact product map recorded on the order.
5. LIMIT execution releases the matching reservation and applies the fill to the same product map in one Firestore transaction.
6. A missing product on a legacy pending LIMIT order resolves to Delivery, including cancellation and execution.
7. Prevent a Delivery SELL from consuming Intraday shares and vice versa.
8. Preserve Firestore transaction atomicity, per-user ownership checks, idempotent replay, version increments, and safe-integer validation.

## Read models and portfolio compatibility

- Account normalization should expose both maps and both mode P&L totals while retaining the existing `positions` and `reservedPositions` Delivery fields.
- Portfolio valuation should value each mode separately and return a combined aggregate for existing portfolio totals.
- Enforce the existing maximum of 50 open cash-equity positions across both modes combined, not 50 per mode.
- Order history should expose normalized product, defaulting legacy orders to Delivery.
- Keep aggregate cash/equity/P&L values consistent and avoid double-counting either mode.

## Frontend requirements

- Add an explicit Delivery / Intraday selector in the Paper Trading order ticket.
- Send the selected product on both MARKET and LIMIT requests.
- Display mode-specific holdings and P&L, alongside clearly labeled combined totals.
- Keep the current default as Delivery so existing behavior is unchanged for users who do not change the selector.
- Do not represent Intraday as auto-square-off. Intraday expiry/forced square-off is a separate feature requiring explicit market-session rules, timezone handling, and tested scheduling; this plan does not silently add it.

## Required test gates before enabling the feature

- Unit tests for product validation, legacy defaults, mode map selection, aggregate P&L, and cross-mode isolation.
- MARKET transaction tests for BUY, partial SELL, full SELL, insufficient holdings, and idempotent replay in both modes.
- LIMIT tests for reservation, cancellation, fill, replay, and legacy pending orders in both modes.
- API tests for omitted/invalid product and mode-aware fingerprints.
- Firestore Emulator tests for concurrent cross-mode orders, shared cash contention, reservation release, and atomic account/order updates.
- Account normalization and portfolio valuation tests for legacy and migrated account documents.
- Frontend tests for selected-mode request payloads and history/portfolio display.
- Run the complete existing gateway test suite and Docker/non-root CI checks.

## Implementation sequence

1. Add and test pure product-mode/account-state helpers without changing routes.
2. Extend the common MARKET accounting transaction and its emulator coverage.
3. Extend LIMIT reservation, cancellation, and execution with legacy Delivery compatibility.
4. Extend account and portfolio read models and order history.
5. Add the frontend selector and mode-aware displays.
6. Run all tests; inspect the complete PR diff and CI results.
7. Only after separate approval, consider staging deployment. Production deployment and scheduled LIMIT worker activation are not part of this work.

## Explicit non-goals

- No Paper Investing work.
- No real broker order submission.
- No separate virtual cash allocation per mode.
- No automatic intraday square-off in this change.
- No scheduled LIMIT worker activation.
- No production deployment or PR merge.
