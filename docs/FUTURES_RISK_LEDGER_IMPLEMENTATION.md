# Futures Risk Ledger & Settlement Engine

## Implemented in this draft

- `paper_futures_risk_events` is a Futures-only append-only accounting journal. Each event is unique by user/event key and payload hash; UPDATE/DELETE is rejected. Retries with the same payload return the original event; key reuse with a changed payload fails.
- `post_paper_futures_daily_mtm` posts signed daily variation to account cash and realized P&L, resets the position's average basis to the official settlement price, advances a versioned settlement state, and records source provenance. It requires an NSE official source URL, a source hash, a fresh source timestamp, a valid tick, and a verified NSE session-calendar row.
- `refresh_paper_futures_margin` atomically reconciles provider initial margin with position/account reservations and records a provider maintenance margin. It requires a fresh, explicit maintenance figure; no percentage is guessed. A shortfall or insufficient available funds sets `MARGIN_CALL`.
- Risk guards block risk-increasing MARKET/LIMIT order inserts and LIMIT fills when the margin state is UNKNOWN, stale (15 minutes), or in MARGIN_CALL. Position-reducing exits remain possible. A new position seeds UNKNOWN until a provider maintenance snapshot is recorded.
- `close_paper_futures_position` supports explicit official NSE expiry settlement and paper-only simulated square-off from a fresh authorized-provider quote. It cancels pending LIMIT orders, releases their unfilled opening/closing reservations, closes the position, books realized P&L and charges, and releases margin in one account-first transaction.
- Negative virtual cash is retained after a loss instead of clipping the MTM debit. `paper_accounts.margin_deficit_paise` is generated from cash and reserved funds.

## Exchange-rule boundaries

NSE Clearing's F&O FAQ says SPAN and ELM are collected upfront; delivery margin and consolidated crystallized obligations have their own collection timing. NSE's derivatives material describes daily settlement using the contract's closing price, ordinarily the last-half-hour weighted average price, with prescribed alternatives when trading is absent; final settlement is based on the official underlying closing value for equity futures. See:

- https://betanseapi.nseindia.com/static/trade/members-faqs-margin-collection-and-reporting
- https://betanseapi.nseindia.com/static/products-services/equity-derivatives-contract-specifications
- https://nsearchives.nseindia.com/web/sites/default/files/inline-files/ISMR-chapter7-web.pdf
- https://betanseapi.nseindia.com/all-reports-derivatives

The code does not calculate SPAN/ELM itself and does not label a configurable rate as exchange margin. Maintenance margin is accepted only as an explicit, fresh provider value. If a provider does not supply it, the risk state remains UNKNOWN and risk-increasing actions are blocked. BSE daily/final settlement is intentionally blocked until BSE-specific verified rules and source integration are added.

## Integration gates still outstanding

- The current Upstox margin normalizer exposes `required_margin`, `final_margin`, and components; it does not currently expose a verified maintenance-margin field. Do not map `required_margin` to maintenance margin. A provider that genuinely supplies maintenance margin (or an authorized source) is required before the refresh RPC can mark a position HEALTHY.
- The settlement, margin-refresh, and square-off RPCs are service-role-only primitives. A scheduled settlement worker/provider ingestion route must call them with authenticated source snapshots before daily MTM/expiry can run automatically. No source data is fabricated here.
- Existing Futures MARKET/LIMIT accounting and order charges remain in their current RPCs; this change adds settlement/maintenance events without replacing those engines.
- This PR is draft-only. Run the disposable PostgreSQL workflow and resolve all failures before considering merge. No hosted migration or deployment is part of this work.
