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
2. Capture the existing account-first lock order and exact columns used by MARKET/LIMIT account, order, position, pending opening-margin, and close-quantity reservations. The PR #89 LIMIT-fill SQL specifically resolves owner, locks `paper_accounts`, locks `paper_futures_orders`, checks the execution-id replay in `paper_futures_fills`, then locks `paper_futures_positions`; this is an observed LIMIT-fill sequence, not yet proof of every MARKET/cancel/worker path.
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
2. Do not invent a new global lock order. Preserve the exact order of each existing lifecycle RPC. In PR #89 LIMIT fill, the observed order is account → order → execution replay lookup → position; any new settlement event/basis locks must be fitted around this only after Chat 3 and Chat 7 approve a cross-RPC order. Audit MARKET, cancel, expiry and worker paths separately before claiming a global order. If paths conflict, stop and redesign with the owning chat rather than silently changing existing RPCs.
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


## 6. Official references consulted

- NSE official F&O Daily Settlement Prices / All Reports – Derivatives: https://www.nseindia.com/all-reports-derivatives
- NSE Clearing official Equity Derivatives settlement-price methodology: https://www.nseclearing.in/clearing-settlement/equity-derivatives/settlement-price
- NSE official F&O consolidated circular register (includes NSE/FAOP/73928 dated 2026-04-28): https://www.nseindia.com/static/resources/consolidated-master-circulars
- NCL/CMPT/77212, Updated SOP on Settlement Price Computation, dated 2026-10-30 (official NCL circular; retrieve the original circular and complete Annexure A from NSE/NCL's official circular archive before coding; no direct public PDF URL was independently verified in this audit).
- SEBI circular HO/47/11/11(3)2025-MRD-POD2/I/23843/2026 dated 2026-10-15; CAS/settlement methodology transition effective 2026-12-07. Use the regulator's original circular and NCL's issued SOP as the controlling documents; secondary summaries are discovery aids only.

The official F&O Daily Settlement Prices report is the authoritative data-ingestion candidate. The report schema, settlement-kind mapping, correction/revision semantics, and exact row-level contract keys must be validated from an actual official sample before enabling ingestion. Do not infer that a report listing alone proves a particular field is an official final settlement value.


## 7. Follow-up code audit — PR #89 lock order and position closure (2026-11-23)

A focused read of `supabase/migrations/20261123170000_futures_limit_atomic_fill.sql` confirms the LIMIT fill transaction:
1. Resolve the order owner without a lock.
2. Lock `paper_accounts` first (`FOR UPDATE`).
3. Lock the owned `paper_futures_orders` row (`FOR UPDATE`).
4. Check the execution-id replay in `paper_futures_fills`.
5. Later lock the matching `paper_futures_positions` row (`FOR UPDATE`).

Opening fills transfer allocated margin from the pending order reservation to position margin without changing aggregate account reserved margin. Closing fills release position margin proportionally, with exact residual release on a full close. A fully closed position is currently **deleted** by this existing LIMIT-fill RPC after the completing order is terminalized; this is Chat 3's established order-lifecycle behavior and must not be changed by Chat 4.

Therefore:
- The prior proposed abstract sequence "account → idempotency/event → order/position" is not an observed implementation contract and has been removed as a prescription.
- Chat 4's expiry settlement must preserve an immutable final position/settlement snapshot in its own Futures risk/settlement event ledger before any approved position-state transition. It must not assume the existing order lifecycle retains zero-quantity position rows.
- Before any new RPC is authored, separately inspect and reconcile MARKET submit/fill, cancel/release, expiry, and PR #93 worker lease lock paths. The LIMIT-fill sequence alone does not prove the global lock order.
- Chat 3 confirmation remains required for close reservation release, pending-to-filled margin transfer and prevention of post-expiry fills. Chat 7 confirmation remains required for shared account lock order and cross-derivative margin conservation.

This follow-up is an audit/documentation correction only; no SQL or runtime code was changed.


Additional PR #89 submit/release audit:
- `submit_paper_futures_limit_order` locks account → existing idempotency/order row (if replay) → matching position. For a new opening LIMIT it increases `paper_accounts.reserved_margin_paise` and stores the same opening reservation on the order; for a close-only LIMIT it increments `paper_futures_positions.reserved_close_quantity` and reserves no opening margin.
- `_release_paper_futures_limit_order` resolves owner, then locks account → order → position (only when a close-quantity release is required). It releases the order's exact remaining opening-margin reservation from the account and separately releases the order's exact remaining close quantity from the position. Replays of terminal orders return zero releases.
- `cancel_paper_futures_limit_order` performs an owner pre-read and delegates to that shared release primitive. `expire_paper_futures_limit_order` delegates to the same primitive.
- Therefore the currently observed PR #89 LIMIT lifecycle has a consistent account-first ordering; order and position lock order differs only by operation and conditional close-reservation handling. The LIMIT fill checks the fill replay after the order lock and before position lock.
- This audit covers the PR #89 LIMIT RPCs only. It does not establish the lock order of legacy MARKET submit/fill/cancel, PR #93 worker lease acquisition/renewal, or any Chat 7 shared Options RPC. Those remain explicit audit/approval gates.


## 8. Follow-up audit — PR #93 worker lease and Futures MARKET RPC (2026-11-23)

### Futures MARKET transaction — verified source
The existing `execute_paper_futures_market_order` definition in `supabase/migrations/20261122120722_futures_market_order_transaction.sql` uses this sequence:
1. Validate request, server clock, quote freshness and contract cutoff before writes.
2. Lock the shared `paper_accounts` row first (`FOR UPDATE`).
3. Lock an existing Futures order by user/idempotency key (`FOR UPDATE`) for replay detection.
4. Lock the matching Futures position (`FOR UPDATE`) for close/open/reversal calculation.
5. Apply the position mutation, update the shared account cash/reserved-margin/realized-P&L/version fields, and insert the terminal MARKET order receipt, all in one transaction.

The MARKET RPC has no separate fill-ledger lookup because MARKET is one terminal execution receipt. It transfers/releases margin in the same account-first transaction, supports signed long/short close and reversal, and deletes a flat position row. The existing `supabase/tests/futures_market_order_accounting.sql` exercises exact replay, changed-payload rejection, partial/full close, reversal, cash/margin reconciliation, stale close-only pre-read fail-closed behavior, split-reservation residuals and stale-quote rejection.

The HTTP route performs a position pre-read only to decide whether to request a provider margin estimate. It explicitly treats that read as potentially stale; the SQL transaction recalculates against its locked position and rejects an opening/reversal when the submitted provider margin is zero. This is a useful fail-closed boundary, not a replacement for transactional validation.

### Worker lease — verified scope and lock interaction
PR #93's worker acquires the dedicated `paper_futures_limit_orders` lease before scanning and releases it in `finally`. Renewal is a separate owner-token-bound update of the `paper_market_worker_state` row; its lease SQL does not lock `paper_accounts`, Futures orders or positions. The worker performs cursor reads/writes outside the order-fill RPC transaction. Each fill is delegated to the existing atomic LIMIT-fill RPC, whose account → order → execution replay → position sequence is documented above. Thus the worker lease row lock is not held in the same SQL transaction as the account/order/position locks; no nested lease→account lock chain was observed in this worker path.

The worker stops starting fills and avoids cursor persistence/expiry side effects after it observes lease loss, and it does not advance the cursor after a failed fill. The heartbeat renewal interval is 60 seconds against a 240-second TTL. The two-connection renewal/reacquisition test covers the lease-row race itself. This audit does not prove a global lock order for other workers or shared Options RPCs.

### Integration findings / open gates
- Observed Futures MARKET and LIMIT paths are account-first, but their remaining lock order differs by lifecycle: MARKET account → idempotency/order → position; LIMIT submit account → idempotency/order replay → position; LIMIT fill account → order → fill replay → position; LIMIT release account → order → position when close reservation release is needed.
- Do not introduce a new settlement/event lock ahead of or between these established locks until Chat 3 and Chat 7 explicitly review a concrete lock graph and concurrency tests.
- The PR #93 worker lease branch extends shared acquire/release/renew allowlists to include both Futures and Options keys. PR #91 also contains overlapping shared lease migration work; one canonical shared migration/history must be agreed before integration. Keep the Futures worker disabled until that reconciliation and staging rehearsal.
- Chat 3 (PR #96) and Chat 7 (PR #97) have not yet provided review/approval in the fetched discussion timeline. No approval is inferred from the comments posted by this workstream.
- This audit is documentation-only. No SQL, runtime code, migration, deployment, feature flag, or broker execution behavior was changed.


### Lease fencing limitation — follow-up risk
The PR #93 worker checks the heartbeat-loss flag before starting fill and expiry RPC calls, but the existing `execute_paper_futures_limit_fill` and `expire_paper_futures_limit_order` calls do not receive or validate the worker lease token in the same database transaction. The lease therefore provides single-writer coordination with cooperative worker cancellation, not a database-enforced fencing token for every side effect. A lease can theoretically be lost after the worker's last in-process check but before the RPC commits. Existing account/order locks, order-state checks and execution idempotency remain important defenses against overfill/replay, but they are not equivalent to lease fencing. Keep this as an explicit reliability review item for Chat 3/Chat 7: either document the acceptable bounded race and prove lifecycle invariants under competing workers, or design a reviewed fencing mechanism that does not change PR #89 lifecycle semantics. No change is authorized here.


## 9. PR #93 lease worker detailed verification (2026-11-23)

- PR #93 head `a0142b35d816c64f9bea767a00eea41f28af6910` has Paper Trading Supabase SQL smoke test Run #1211 SUCCESS. This confirms that workflow only; it does not prove a full production rollout or eliminate the fencing limitation below.
- Worker cursor reset/save updates are guarded by both `state_key='paper_futures_limit_orders'` and the current `lease_token`. The `finally` release is also owner-token-bound, so a stale worker cannot clear a replacement owner's lease.
- Worker checks `summary.leaseLost` immediately before invoking fill/expiry side-effect RPCs. However the calls `execute_paper_futures_limit_fill(p_order_id, ...)` and `expire_paper_futures_limit_order(p_order_id)` carry no lease token. A heartbeat can report loss after the in-process check or while an RPC is in flight; the database cannot reject that RPC based on the superseded lease. This confirms the fencing risk is a narrow TOCTOU window, not an observed nested-lock deadlock.
- SQL tests cover exclusive acquisition, non-owner release rejection, idempotent release, reuse, preservation of equity/intraday/protective/Options namespaces, owner-only renewal, expiry non-resurrection, and two-connection renewal-versus-reacquisition races. The Node worker tests cover stop-before-new-fill/expiry after a reported lease loss, no cursor advance after failed fills, and owner-token cursor writes. They do not simulate lease loss precisely between the final in-process check and a successful side-effect RPC commit.
- Shared lease migration overlap remains unresolved: PR #93 adds Futures and Options allowlist entries to acquire/release, and adds renewal for those keys; PR #91's Options lease work must be reconciled into one canonical ordered migration chain. Do not cherry-pick or deploy either overlapping shared migration in isolation without Chat 7's confirmation.
- Current Chat 3 PR #96 and Chat 7 PR #97 still show only the coordination comments from this workstream and no review submissions. Their approval remains pending.
