# Futures Risk & Accounting — Implementation Plan

**Status:** Planning artifact only. No SQL migration, RPC, worker, feature flag, database write, deployment, or production activation is authorized by this document.
**Scope:** ZENURA IGNITE S-TRADE, NSE Futures paper trading only.
**Parent baseline:** PR #108 head `aa1766724fdd88dda56b6e7f230e00d4d6ccc399`, based on PR #93 worker-lease branch.
**Design input:** PR #110, `docs/NSE_FUTURES_DAILY_MTM_EXPIRY_SETTLEMENT_DESIGN.md`.

## 1. Ownership and integration boundaries

- Chat 3 owns Futures MARKET/LIMIT order and position lifecycle. Preserve PR #89 atomic partial-fill settlement and the current order/position RPC contracts. Do not change order fill semantics, order idempotency, quote execution, or position mutation without Chat 3 review.
- Chat 4 owns Futures risk/accounting: margin snapshots and reservation accounting, MTM, daily variation, expiry settlement, maintenance breach and paper-only liquidation simulation.
- Chat 7 owns the adjacent Options/database workstream. Preserve Options reservations, shared account invariants, tenant isolation, and existing Options worker namespace. Coordinate any shared account/ledger/lock/schema change before implementation.
- PR #93 owns the shared market worker lease primitive. Treat it as a dependency only; do not alter acquire/renew/release functions or lease namespace in this workstream.
- PR #108 is deterministic JavaScript simulation arithmetic, not a persistent accounting implementation. PR #110 is design-only. Neither is evidence that settlement RPCs exist.
- All new persistent objects must be Futures-specific unless Chat 3/Chat 7 explicitly approve a shared change. No Crypto, Equity, Options, generic worker, auth, or common account-schema refactor in this workstream.

## 2. Required implementation sequence

### Phase 0 — Baseline and contract freeze
1. Reconcile PR #87/#88/#89/#93/#96 and PR #108/#110 branch ancestry and migration order before any persistent code.
2. Capture the existing account-first lock order and exact columns used by MARKET/LIMIT account, order, position, pending opening-margin, and close-quantity reservations.
3. Add a written cross-chat interface contract: Chat 3 owns order/position lifecycle; Chat 4 owns risk/settlement events; Chat 7 reviews shared account and Options coexistence.
4. Keep all worker/submit flags disabled.

### Phase 1 — Pure accounting domain and invariants
1. Retain integer-paise pure helpers, but make all public functions validate every input and use checked BigInt intermediates.
2. Define one canonical margin snapshot:
   - `used_margin_paise = open Futures position margin + pending Futures opening-order margin`.
   - `available_margin_paise = cash_paise - reserved_cash_paise - all applicable used/reserved margin`, using the canonical shared-account contract rather than double-counting an existing account reservation.
   - Keep position margin, pending order reservation, reserved cash, and maintenance requirement as distinct dimensions.
3. Reservation and release must reference an owned position/order reservation. Never release a caller-supplied arbitrary amount without proving the source reservation and remaining balance.
4. Define conservation assertions before writing RPCs:
   - Account Futures reserved margin equals open Futures position margin plus pending Futures opening-order reservations.
   - Each position margin equals allocated margin + additions - releases and is never negative.
   - Account cash/margin deltas reconcile to immutable risk/settlement events.
   - Options and other derivative reservations remain included in the shared account constraint exactly once.

### Phase 2 — Futures-only event and settlement-basis schema design
Propose, then review before implementation:
- Immutable Futures risk/settlement event ledger with unique account-scoped idempotency key, canonical payload hash, event type, exact contract identity, signed quantity, price/basis, source provenance, model/version, cash delta, margin delta, realized/variation P&L delta, simulation-only marker and server timestamp.
- Verified settlement-price snapshot store with immutable source payload/hash, report identity, exchange business date, settlement kind, contract identity, source revision and verifier/ingestion metadata.
- Position settlement-basis state (or a Futures-only one-to-one basis table) with last accepted official settlement price, date, source snapshot, basis version and last event identity.
- Unique constraints for one daily settlement per account/position/contract/session and one final expiry settlement per contract position.
- RLS enabled, no client mutation grants, service-role-only RPC execution, fixed empty search_path. Append-only event rows; corrections use compensating events.

Do not duplicate the existing order fill ledger. Risk/settlement events are a separate accounting dimension.

### Phase 3 — Atomic margin reservation and release
1. Implement Futures-only reserve/release RPCs only after Chat 3 confirms the order/position handoff contract.
2. Lock in the agreed global order: shared account first; idempotency/event identity next; then order/position and any basis row in deterministic order. If an existing RPC's actual order differs, stop and obtain cross-chat approval rather than silently changing it.
3. Reserve opening margin atomically with order/position state and event insertion. Release only the exact remaining reservation on cancel, expiry, close, or terminal settlement.
4. Same idempotency key + same canonical payload returns the original receipt; same key + changed payload is a hard conflict.
5. Concurrent updates must serialize on the account row and pass two-connection race tests.

### Phase 4 — MTM separation and daily variation cash posting
Keep three independent P&L concepts:
- Trade-close realized P&L from fills.
- Daily variation margin cash settled from the prior official settlement basis.
- Current quote-based unrealized P&L from the latest mark.

For signed open quantity q, prior settlement S_prev and current official settlement S_t (all prices paise):
`variation_paise = q * (S_t - S_prev)`.

Within one transaction: validate trusted snapshot; lock account and position/basis; insert immutable event; post cash delta; advance settlement basis exactly once; increment account version. Quantity and reserved margin do not change on daily MTM. Unrealized P&L after settlement is measured from S_t, not from the old entry price, preventing double counting.

Opening-day positions require an explicitly approved basis convention. Until that is approved, reject/hold the daily posting rather than infer a settlement basis from LTP or a provider quote.

### Phase 5 — Final expiry settlement and position closure
1. Require a verified official FINAL_EXPIRY snapshot for the exact contract and exchange business date.
2. Compute final variation from the last official daily basis, or the explicitly approved initial basis if no daily basis exists.
3. In one idempotent transaction: post final cash variation; append final settlement event; terminalize (do not delete) the position; record original signed quantity, final price, basis, P&L, source snapshot and released margin; release exactly the residual position margin.
4. Pending LIMIT opening-margin and close-quantity reservations are separate from position margin. Expire/cancel them using Chat 3's existing lifecycle RPCs, either in a separately idempotent transaction or a reviewed atomic extension. Never release them as position margin.
5. Reject fills/reopens after final settlement. A conflicting settlement replay is a hard conflict.

### Phase 6 — Maintenance breach and forced-liquidation simulation
1. Compute maintenance equity and deficit from an explicitly versioned configurable simulation model.
2. Breach is a risk state/event, not an exchange margin call or exchange liquidation notice.
3. Forced liquidation is a separately configured paper simulation event only. It must not call Upstox, broker order APIs, or MARKET/LIMIT execution routes.
4. Model slippage, charges, partial liquidation, residual quantity and residual margin release explicitly. Do not imply guaranteed liquidation where simulated depth is insufficient.
5. Keep `margin_model = CONFIGURABLE_SIMULATION`; never label it NSE/SPAN/official margin.

### Phase 7 — Regression, concurrency and reconciliation gates
- Long/short margin reserve, partial release, full release, over-release rejection, insufficient funds and safe-integer boundary.
- Long/short MTM profit/loss; zero variation; multi-day basis roll-forward; opening-day basis; daily replay and changed-payload conflict.
- Final expiry with/without prior daily settlement; long/short profit/loss/zero; partial-close history; exact residual margin release; terminal position audit.
- Pending LIMIT reservation expiry versus position settlement; close/fill/cancel/expiry versus settlement races.
- Two users holding the same contract; same account concurrent reserve/release; two concurrent daily settlement workers; daily versus final settlement race.
- Maintenance breach thresholds, recovery, simulated liquidation partial fill, insufficient depth, charges and no broker-route assertion.
- Conservation: cash delta = immutable cash events; account reserved margin = sum of canonical reservations; position margin never negative; no duplicate event effect; no double-counted MTM in equity.
- Security: anon/authenticated cannot mutate tables or execute RPCs; service role only; RLS/tenant isolation.
- Run complete gateway tests and ordered disposable PostgreSQL migrations only. Production/staging migrations remain prohibited.

## 3. Official settlement source and provenance decision

### Approved authority and ingestion hierarchy
1. Authority is **NSE Clearing / NSE official exchange publications**, not Upstox market quotes.
2. Primary ingestion candidate for daily settlement values: NSE's official **All Reports – Derivatives → F&O – Daily Settlement Prices** report (daily CSV, currently exposed with a `FOSett_prce_<date>.csv` naming pattern). The official report page also exposes the final UDiFF Common Bhavcopy and the current NSE F&O contract master. Confirm the exact CSV schema and settlement-kind fields against a downloaded official sample before writing the importer.
3. Rule semantics must be versioned against the official NSE Clearing Settlement Price page, applicable NSE/NCL circulars and SOPs. The source file is the price record; the rulebook/SOP is the methodology authority.
4. Never derive an official settlement price from Upstox LTP, quote close, chart candles, browser input, or a broker margin preview. Never synthesize a missing official value.
5. If the official file is missing, stale, conflicting, revised without a traceable revision, contract-mismatched, or cannot be tied to the exact expiry/instrument, fail closed and do not post cash.

### Effective-date handling
- The current settlement methodology and the revised Closing Auction Session (CAS) SOP have effective dates. The October 30, 2026 NCL SOP (NCL/CMPT/77212) and SEBI's October 15, 2026 CAS review indicate a methodology transition effective **2026-12-07**. Do not apply future rules early.
- Store a `methodology_version` and `effective_from` with each verified snapshot. Resolve methodology by exchange business date, instrument type (index vs stock), and effective date.
- For index and stock derivatives, treat daily settlement and final expiry settlement as distinct methodologies. The current NSE Clearing page describes daily futures settlement using the last 30-minute contract VWAP (with theoretical-price treatment for illiquid contracts) and final settlement separately for index and individual securities. The October 2026 joint SOP adds scenario-specific handling and two-decimal mathematical rounding; implement only after confirming its effective date and complete annexure.
- For final expiry after 2026-12-07, apply the revised SOP's stock/index-specific CTS VWAP methodology and its scenario fallbacks only when the official clearing report publishes the verified result. Do not recompute the clearing corporation's final price from constituent/underlying data inside S-TRADE.

### Required provenance fields
- exchange = NSE; segment = NSE_FO; instrument key/token; trading symbol; instrument type FUTIDX/FUTSTK; underlying; expiry; lot size; tick size.
- settlement kind DAILY or FINAL_EXPIRY; exchange business date (Asia/Kolkata); price in paise; official report filename; source URL/reference; report row identity; downloaded-at timestamp; source file SHA-256; methodology version/effective date; source revision/correction marker; ingestion verifier identity.
- Preserve the original report bytes or an immutable source artifact reference. Re-importing a corrected file must create a new source revision and a controlled supersession record, never overwrite an already-posted settlement.

## 4. Paise conversion and rounding decision

1. Parse official decimal prices as strings using exact decimal arithmetic; never use JavaScript binary floating-point for price conversion or P&L.
2. Store one rupee = 100 paise. Convert a source price rounded to two decimal places into integer paise exactly.
3. Where the applicable official SOP says values with more than two decimals are rounded to two decimals using simple mathematical rounding, implement positive-price half-up rounding in the ingestion adapter and record the raw source value, rounded paise value, and rounding rule/version. Confirm tie-case behavior against the final official SOP annexure before productionizing.
4. Do not add a second rounding step to variation P&L: with signed integer quantity and integer-paise prices, `q * (S_t - S_prev)` is already an exact integer-paise amount. Use checked BigInt multiplication and reject overflow outside the database integer range.
5. Do not round variation P&L per lot or per unit. Multiply total signed quantity by the paise difference once.
6. Do not snap an official settlement price to the tradable order tick size. The settlement price is an exchange-computed value and its official rounding convention is separate from order-entry tick validation. Validate source precision and contract identity; apply tick checks to executable order prices, not as an invented settlement-price adjustment.
7. Do not round margin rates or notional through floating point. Configurable scenario margin uses integer basis points and a documented ceiling rule to avoid under-reserving: `ceil(notional_paise * rate_bps / 10000)`. This is simulation policy, not NSE/SPAN margin methodology.

## 5. Decisions still requiring explicit review before implementation
- Chat 3 approval of the account/order/position lock sequence and the precise handoff between pending LIMIT reservations and position margin.
- Chat 7 review of shared-account available/used margin treatment, Options coexistence, RLS/grants and cross-derivative conservation.
- Confirm official F&O Daily Settlement Prices CSV schema and whether it explicitly contains both daily and final expiry rows/flags for all supported contract types.
- Confirm the complete NCL/CMPT/77212 Annexure A and its effective date mapping, including illiquid daily futures and final expiry fallback cases.
- Confirm the exact two-decimal half-up/tie convention in the authoritative SOP and test it against official sample files.
- Confirm account cash policy for daily settlement losses that exceed available virtual cash (reject atomically vs explicitly modeled negative cash/debt state).

**No implementation or production migration may proceed until these decisions and the disposable PostgreSQL concurrency suite are reviewed.**
