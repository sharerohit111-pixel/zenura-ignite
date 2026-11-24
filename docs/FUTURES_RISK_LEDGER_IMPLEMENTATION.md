# Futures Risk Ledger & Settlement Engine

## Implemented in this draft

- `paper_futures_risk_events` is a Futures-only append-only risk/accounting journal. Events are unique by user/event key and payload hash; UPDATE/DELETE is rejected. Same-payload retries return the original receipt; changed-payload key reuse fails.
- `post_paper_futures_daily_mtm` posts signed daily variation to account cash and realized P&L, resets the position's working average basis to the official settlement price, advances a versioned settlement state, and requires an official NSE source URL/hash plus a verified NSE session-calendar row.
- `refresh_paper_futures_margin` reconciles provider initial margin with position/account reservations and stores an explicit provider maintenance figure. It never invents a maintenance percentage. A maintenance breach or insufficient available funds sets `MARGIN_CALL`.
- Risk guards reject unreserved risk increases in UNKNOWN/stale maintenance state and reject all risk increases in MARGIN_CALL. UNKNOWN/stale state still permits an order only when a positive provider initial-margin reservation is supplied; this does not mark the position HEALTHY. Reducing exits remain available.
- `close_paper_futures_position` supports explicit NSE expiry settlement and paper-only square-off from a fresh authorized-provider quote. It terminalizes pending LIMIT orders, releases their unfilled opening/closing reservations, books realized P&L and charges, and releases margin atomically.
- Negative virtual cash is retained rather than clipping a daily MTM debit. `paper_accounts.margin_deficit_paise` is generated from cash and reserved funds.

## Exchange-rule boundaries

NSE Clearing's F&O FAQ states SPAN and ELM are collected upfront; delivery margin and consolidated crystallized obligations have their own collection timing. NSE derivatives material describes daily futures settlement using the official daily settlement price (ordinarily the last-half-hour weighted average price for equity futures, with prescribed alternatives) and final settlement using the official final settlement price.

- https://betanseapi.nseindia.com/static/trade/members-faqs-margin-collection-and-reporting
- https://betanseapi.nseindia.com/static/products-services/equity-derivatives-contract-specifications
- https://nsearchives.nseindia.com/web/sites/default/files/inline-files/ISMR-chapter7-web.pdf
- https://betanseapi.nseindia.com/all-reports-derivatives

The code does not calculate SPAN/ELM itself and does not label configurable rates as exchange margin. Maintenance margin is accepted only as an explicit provider value. The current Upstox margin normalizer exposes required_margin, final_margin and components, but no verified maintenance-margin field; required_margin is not treated as maintenance. Consequently a position cannot be marked HEALTHY until an authorized provider/source supplies the maintenance figure. MARGIN_CALL always blocks risk increases; UNKNOWN/stale state still requires a positive initial-margin reservation and remains visibly UNKNOWN.

BSE daily/final settlement is deliberately blocked until BSE-specific verified rules and source integration are added.

## Integration gates still outstanding

- A scheduled official settlement ingestion/worker must call the service-role settlement RPCs with verified price snapshots before automated daily MTM and expiry processing can run. The RPCs are implemented; the worker/provider ingestion path is not.
- The paper simulator posts daily variation to virtual cash when the settlement RPC runs; it does not yet emulate the exchange's T+1 pay-in/pay-out cash timing as a separate receivable/payable.
- The position's working average basis resets to each daily settlement price so later close P&L does not double-count variation. Treat this field as the current futures settlement basis, not lifetime original entry price.
- Existing Futures MARKET/LIMIT orders and their charge calculations remain in their current accounting RPCs. This new append-only risk journal covers margin/settlement/square-off events; it does not replace or rewrite the existing order/fill records.
- Draft-only. Run the full disposable PostgreSQL/regression workflow and resolve all failures before considering merge. No hosted migration or deployment is part of this work.
