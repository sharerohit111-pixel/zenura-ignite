# Indian Market Futures & Options LIMIT Lifecycle Audit

**Status:** design/audit only — no F&O LIMIT execution is enabled by this document.

**Scope:** NSE/BSE Futures and Options in ZENURA IGNITE Paper Trading. Crypto is out of scope. This document does not authorize production migrations, deployment, or PR merge.

## Verified current state

- The Futures gateway accepts MARKET only and rejects LIMIT/unknown order types before instrument/provider/database work.
- The Options gateway accepts MARKET only and rejects LIMIT/unknown order types before instrument/provider/database work.
- Current Futures SQL execution is a single atomic MARKET fill. It performs account-first locking, validates a fresh quote and expiry cutoff, reserves/releases margin for the resulting position, books charges and realized P&L, and stores a FILLED order receipt.
- Current long Options SQL execution is a single atomic MARKET BUY or SELL-to-close. It books premium, charges and fee-inclusive cost basis; it does not create short option exposure.
- The Futures order table already has LIMIT metadata and PENDING status fields, but the current Futures execution RPC does not implement LIMIT reservation, cancellation, or fill.
- Existing Options execution records MARKET/FILLED receipts. No verified Options LIMIT reservation/fill/cancel RPC or dedicated worker was found in the current implementation.
- The repository contains separate equity Delivery and Intraday LIMIT workers and transaction paths. Those are useful design references, not safe drop-in F&O workers.
- No dedicated Futures/Options expiry settlement worker is present. An option payoff helper is not a settlement engine.

## Required lifecycle before enabling F&O LIMIT

### 1. Contract and session gate
- Resolve contract metadata only from the verified official NSE/BSE instrument master.
- Validate exchange/segment, instrument type, symbol/key, expiry, lot size, tick size, price, quantity-in-whole-lots, and contract status.
- Require the matching verified exchange session/calendar and current session date.
- Reject stale, future-dated, mismatched, or out-of-session quotes. Enforce the exclusive expiry-day 15:30 IST cutoff in both gateway and SQL.
- Never treat a browser-supplied contract, price, margin, fee, or timestamp as authoritative.

### 2. Reservation rules
- **Futures:** calculate the open/reversal quantity under the same account-first transaction that reserves margin. Use a current trusted broker margin snapshot; do not derive a lower reserve from a stale position snapshot. Close-only quantity must reserve/lock the position exposure so another order cannot consume it. Preserve existing reserved margin for unrelated positions.
- **Long Options:** BUY reserves premium plus conservative charges. SELL-to-close reserves the exact unreserved long quantity/lots; short option opening remains disabled. Do not allow another order or protective exit to consume reserved lots.
- All reservation amounts are integer paise. Release only the reservation owned by the order, proportionally and deterministically for partial fills/cancel remainder. Never release another position's or order's reservation.

### 3. Durable order/fill state
- Add forward-only schema changes after a migration design review. Model cumulative filled quantity, remaining quantity, average fill price, cumulative charges, reservation remaining/released, and terminal timestamps explicitly.
- Add an append-only fill ledger with a unique deterministic execution identity per order/fill sequence. Enforce unique idempotency at both order submission and fill recording.
- Use explicit lifecycle states such as PENDING, PARTIALLY_FILLED, FILLED, CANCELLED, EXPIRED, and REJECTED; define legal transitions in SQL, not only in worker code.
- A repeated submit/fill/cancel must return the saved receipt or terminal state and must never double-debit cash, double-release margin, double-book charges, or duplicate a fill.

### 4. Atomic concurrency and cancellation
- Use the verified existing writer lock order across submit, fill, cancel, and expiry: account row → order/idempotency row → position/reservation rows; re-read status after locks. Do not introduce a position-before-order writer while MARKET writers use order-before-position.
- A fill racing cancellation must have exactly one winner. If cancellation wins, no later fill may change the order. If a fill wins, cancellation may only cancel the unfilled remainder.
- Test two workers racing the same order, two orders competing for the same position, duplicate requests, partial fill versus cancel, and stale pre-transaction position snapshots.
- Use transaction-level assertions to preserve account invariants:
  `reserved_cash + reserved_margin <= cash`, nonnegative balances/reservations, and reserved close quantity never exceeding available position quantity.

### 5. Worker and quote discipline
- Implement a dedicated F&O LIMIT worker only after SQL reservation/fill/cancel functions and race tests exist.
- Worker must use a separate renewable single-writer lease, bounded batches, fair cursor rotation, and per-user provider authorization.
- Require a fresh quote for the exact instrument and the correct limit trigger: BUY when executable ask/price is at or below limit; SELL when executable bid/price is at or above limit. Do not trigger from a mismatched or stale LTP snapshot.
- Revalidate contract/session/expiry and order status immediately before the atomic fill RPC. A worker must not trust its own earlier scan snapshot.

### 6. Expiry and settlement are separate release gates
- Expire/cancel unfilled LIMIT remainder at the verified exchange/contract cutoff and release only the remaining reservation.
- Do not synthesize Futures or Options settlement from last traded price or the payoff helper.
- A separate expiry settlement engine needs authoritative exchange settlement prices, contract-specific rules, index-vs-stock derivative handling, option exercise/assignment outcomes, physical-settlement obligations where applicable, charges, and idempotent reconciliation. Keep expiry settlement disabled until those inputs and tests are available.

## Required test matrix

- Submit: valid/invalid contract, wrong exchange/segment, non-lot quantity, off-tick price, closed session, holiday, expired contract, stale/future/mismatched quote, insufficient cash/margin.
- Reservation: opening, add-on, close-only, partial close, reversal, multiple open positions, repeated partial fills with rounding, and unrelated reservations preserved.
- Fill: BUY/SELL threshold boundaries, partial/full fill, weighted average, fee/charge parity, exact cash/margin/position ledger reconciliation.
- Idempotency: duplicate submit, duplicate fill, retry after timeout/provider outage, same key with changed payload.
- Concurrency: fill-vs-cancel, fill-vs-expiry, competing closes, competing opening/reversal orders, two worker instances, lease expiry/reacquisition.
- Security: service-role-only RPC grants, empty search_path on SECURITY DEFINER functions, RLS/tenant isolation, authenticated owner-bound cancel endpoint.
- Recovery: worker restart, lease timeout, provider token expiry, malformed provider response, stale quote, partial batch failure, reconciliation after a failed cycle.

## Release decision

Keep Futures/Options LIMIT and protective exits disabled until every applicable test above passes in disposable PostgreSQL and gateway CI, the worker lease/recovery behavior is verified, and the implementation is reviewed as a complete ledger lifecycle. This audit is not a production-readiness approval.


## Follow-up implementation review — existing SQL lock order (2026-11-23)

A source-level review of the current MARKET transaction functions confirms the actual lock sequence is **account row → existing order/idempotency row → position row** in both the Futures and long-Options SQL functions. The account row is acquired first and serializes account writes; the order lookup follows; the position row is then locked before ledger mutation.

The generic lock-order sentence in the original checklist (account → position/reservation → order) must therefore not be implemented literally. Any future F&O LIMIT submit/fill/cancel/expiry RPC must preserve the established account → order → position sequence, including idempotent replay paths, or document and prove a safe global transition before changing all writers together. In particular, do not add a worker that locks position then order while existing MARKET RPCs lock order then position.

This review remains design-only. No runtime, schema, API, worker, or production data was changed. The F&O LIMIT release gates remain closed.


## Follow-up implementation review — worker lease isolation (2026-11-23)

The existing Supabase lease RPC currently allowlists only `paper_limit_orders` and `paper_protective_orders`. It does not expose a derivative-specific lease namespace. F&O LIMIT must therefore receive its own dedicated lease state key (for example, `paper_derivative_limit_orders`) and a narrowly scoped forward-only migration/RPC allowlist update after the derivative worker is implemented and tested. Do not reuse the equity LIMIT or protective-order cursor/lease: doing so would couple independent worker batches and create ambiguous ownership/recovery behavior.

The lease is not a substitute for order-level atomicity. The fill/cancel/expiry RPCs must revalidate order state and quote freshness under the established account → order → position lock sequence, even when a worker holds the lease. This remains a design finding only; no lease schema, worker, or runtime was changed.


## Follow-up schema compatibility review (2026-11-23)

The current order-table constraints are materially different and must be handled explicitly before any derivative LIMIT writer is added:

- `paper_futures_orders` already has LIMIT/PENDING columns and a pending-order partial index, plus a per-user idempotency unique index. These are metadata and indexing only; the existing Futures MARKET RPC inserts FILLED rows and does not reserve pending LIMIT margin.
- `paper_derivative_orders` is stricter: `order_type` is constrained to MARKET only and `status` to FILLED/REJECTED. A proper Options LIMIT lifecycle therefore needs a forward-only constraint replacement and additional reservation/fill/cancel fields. Do not weaken the MARKET-only check in place without a complete tested transition plan.
- `paper_derivative_positions` is long CE/PE only and requires positive net quantity; it must not be reused for Futures signed positions. Futures has its own signed-quantity position table and account-level reserved-margin ledger.
- The existing Futures position row records a single aggregate reserved margin amount. A LIMIT reservation model must distinguish pending-order margin from filled-position margin so partial fills/cancellation can release only the unfilled remainder, and account totals continue reconciling.
- The existing derivative orders are execution receipts, not a fill ledger. A future partial-fill implementation needs immutable per-fill records with unique execution identifiers and an atomic aggregate order-state transition; mutating one receipt row is not sufficient audit history.

This is source/schema review only. No constraints were relaxed, no new tables or columns were added, and no production state was changed. The next safe implementation step is a disposable SQL design/test harness for Futures pending-margin accounting before introducing any production-facing worker or API.


## Follow-up implementation review — deterministic reservation allocation primitive (2026-11-23)

A pure gateway arithmetic helper now defines how an already-authorized Futures LIMIT reservation is transferred from pending-order reserve to filled-position reserve across partial fills:

- All inputs and outputs are safe integer paise / integer quantities; floating-point money arithmetic is not used.
- Each non-final fill receives floor(remaining reserved paise × fill quantity ÷ remaining quantity).
- The final fill receives the exact remaining paise, eliminating rounding dust and guaranteeing cumulative transfers equal the original reservation.
- Cancellation releases only the still-pending reservation remainder.
- Unit tests cover 3-way allocation of ₹20.00 as 666/667/667 paise, uneven allocation with a final residual, cancellation remainder release, and invalid/unsafe inputs.

Files: `market-gateway/lib/futures-limit-reservation.js` and `market-gateway/test/futures-limit-reservation.test.js`.

This helper is deliberately not connected to any order route, worker, database RPC, or production ledger. It solves only deterministic integer-paise allocation; it does not calculate broker margin, lock close quantity, authorize a fill, or make fill/cancel atomic. Those responsibilities remain in a future SQL transaction and must be independently tested before F&O LIMIT is enabled.


## Futures LIMIT ledger design boundary — before any migration

The existing `paper_futures_orders.margin_reserved_paise` field is a MARKET execution receipt field; it is not sufficient to represent the lifecycle of a partially filled LIMIT order. A reviewed forward-only schema proposal must separate these concepts:

1. **Order aggregate:** requested quantity, cumulative filled quantity, remaining quantity, average fill price, cumulative charges, current status, pending opening-margin remainder, pending close-quantity remainder, and terminal timestamps. Enforce `requested = filled + remaining` and nonnegative quantities in SQL.
2. **Pending reservation ledger:** one owner/order-bound reservation record with distinct opening-margin paise and close-quantity units. Pending opening margin must remain separate from `paper_futures_positions.reserved_margin_paise`; on each fill, transfer only the fill's allocated reserve to the resulting position and decrement the order reserve in the same transaction. Cancellation releases only the unfilled remainder.
3. **Immutable fills:** append-only fill rows with a deterministic unique execution identity, order ID, sequence, quantity, price, quote timestamp, charges, realized P&L, and reservation transfer. A duplicate execution identity returns the stored fill and cannot mutate balances twice.
4. **Position close locks:** a close/reversal order must reserve the exact closeable signed quantity under the position row lock. Competing orders see only unreserved quantity. For a reversal, separately track the close slice and the opening remainder; margin is reserved only for the opening slice using a trusted, current provider margin result.
5. **Atomic transition:** account → order/idempotency → position/reservation locks; re-read order state, quote, expiry/session, and remaining quantities after locks; insert fill, update aggregate, move margin, update signed position, and update account in one SQL transaction. A fill-vs-cancel race must resolve through this same serialized state transition.

Do not add columns or loosen the existing order constraints until this design is converted into exact forward-only DDL, SQL RPC signatures/grants, RLS review, and disposable PostgreSQL race tests. In particular, never interpret the existing `margin_reserved_paise` receipt as pending reserve or reuse the long-Options position table for Futures.
