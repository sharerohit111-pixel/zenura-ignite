# NSE Futures Multi-Level MARKET Execution — Design Proposal

**Status:** Design only. No runtime code, SQL migration, RPC, worker, production database write, deployment, or feature activation is included.

**Scope:** NSE Futures Paper Trading MARKET orders only. Crypto, Equity, Options, BSE, and the existing Futures LIMIT lifecycle are out of scope.

## 1. Verified baseline

The current Futures MARKET route:
- obtains a fresh Upstox V3 order-book snapshot;
- validates the best executable ask for BUY or best executable bid for SELL;
- rejects stale, missing, crossed, off-tick, or insufficient top-level displayed depth;
- passes one `p_execution_price_paise` and the submitted quantity to the existing atomic `execute_paper_futures_market_order` RPC.

The current pure execution helper returns one execution price and does not model a sweep across multiple depth levels. The existing MARKET receipt/RPC is therefore a single-price transaction contract. Do not silently pass a VWAP into it and claim that individual price-level fills were preserved.

## 2. Proposed execution semantics

For a BUY, consume asks from lowest to highest price. For a SELL, consume bids from highest to lowest price.

For each level:
- validate positive integer price and positive integer displayed quantity;
- validate price is on the exact contract tick;
- require the selected side's prices to be monotonically executable (asks non-decreasing, bids non-increasing);
- consume only the remaining requested quantity;
- record the level price and consumed quantity as a distinct fill.

A market order is fully executable only when the validated snapshot provides enough aggregate displayed depth for the entire requested quantity. Until an explicit product decision authorizes partial MARKET fills, preserve current fail-closed all-or-nothing behavior: insufficient aggregate depth rejects without any accounting mutation. Do not synthesize liquidity, use LTP, extrapolate depth, or consume the opposite side.

Example BUY: requested 100; asks 100.00 × 40, 100.05 × 35, 100.10 × 25. Record three fills (40, 35, 25). Weighted average = sum(price × quantity) / 100, while the immutable fill ledger retains each actual level price. The aggregate average is a display/receipt field, not a replacement for fill rows.

## 3. Quote snapshot validation

The parser/helper must accept the full provider depth array for the exact instrument key and one provider snapshot timestamp. Reject the whole snapshot when:
- instrument identity is absent or mismatched;
- timestamp is missing, in the future beyond allowed clock skew, or older than the existing 15-second freshness policy;
- either side is malformed, contains non-positive/unsafe values, or violates price ordering;
- best bid exceeds best ask;
- any consumed level is off tick;
- arithmetic exceeds safe integer / PostgreSQL bigint bounds;
- the requested quantity cannot be completely swept.

Do not mix levels from separate snapshots or combine REST and streaming depth. Retain source timestamp and a deterministic hash of the canonical consumed snapshot/levels for audit and replay comparison. Never trust a client-supplied depth array.

## 3A. Depth helper status (PR #109)

The isolated helper in PR #109 now computes a deterministic SHA-256 `snapshotHash` from the validated instrument key, provider timestamp, and normalized full bid/ask levels. The implementation and regression assertion are on branch `feature/nse-futures-depth-sweep-helper-2026-11-23` (latest test commit `6c8195308ea5c3893483d1a1cdc4e944354b0e94`). This remains a pure simulation helper: it does not fetch provider data, persist an order, or authorize accounting writes. GitHub Actions run #1419 for PR #109 head `d12940ddbf084c8f0eb7bf643b12f848f178d222` completed successfully, including the dedicated `node --check` / `node --test` helper step, the complete `market-gateway` regression suite, and the disposable PostgreSQL migration/accounting/security checks. The hash is audit/replay metadata only; the future atomic RPC must independently validate the supplied fill structure and idempotency payload rather than trusting a client-provided hash.

## 4. Atomic transaction contract — coordination required

A future implementation must extend or replace the single-price MARKET RPC with one service-only atomic batch contract. Proposed input conceptually includes:
- existing order ID, idempotency key and request fingerprint;
- exact NSE_FO FUT instrument/contract metadata;
- side, product and requested quantity;
- ordered execution-level array: price paise + consumed quantity;
- snapshot timestamp, source identity and canonical snapshot hash;
- provider-derived opening-margin estimate and aggregate charges, with a documented allocation rule.

The SQL transaction must revalidate all structural invariants and write the order receipt plus every fill in one transaction. Required lock order remains **account → order/idempotency identity → position**, consistent with existing Futures writers. Position and account balances must never be mutated once per level outside this single transaction.

Before coding, the Futures accounting/margin workstream must approve:
1. whether the existing `paper_futures_fills` schema can represent MARKET fills without colliding with LIMIT execution identity/sequence rules;
2. unique constraints and deterministic fill sequence/IDs for one MARKET order;
3. the order receipt's average-price and execution-price compatibility contract;
4. exact charge calculation and allocation across levels;
5. opening margin sizing and reversal/partial-close treatment;
6. integer rounding, overflow bounds and conservation equations;
7. RLS, grants, tenant isolation, retry semantics and concurrency tests.

Do not modify shared accounting/margin tables or RPCs in this design-only change.

## 4A. Cross-workstream compatibility audit (2026-11-24)

Reviewed PR #106 (head `74d9f675aeb8b9b7fb433358e2a43a9c92470d0a`), PR #89's LIMIT ledger foundation, and the dependent LIMIT fill migration. Findings:

1. **PR #106 is not a persistent accounting implementation or approval.** Its changed runtime files are a pure JavaScript simulation helper and unit tests; its remaining changes are workflow coverage and design/audit documents. It adds no Futures migration, SQL RPC, durable event ledger, or fill-schema extension. `reserveSimulatedMargin` / `releaseSimulatedMargin` return calculated objects only; they do not own persisted reservation identities or post accounting events. Its rates are explicitly `CONFIGURABLE_SIMULATION`, not exchange margin.
2. **The existing MARKET RPC is single-price.** `execute_paper_futures_market_order` accepts one `p_execution_price_paise`, one quantity, one opening-margin amount and one aggregate charge amount. It updates position/account once and writes a single MARKET order receipt; it does not write rows to `paper_futures_fills`. A VWAP passed to this RPC would erase per-level execution prices.
3. **The existing fill ledger is structurally reusable only with a new batch contract, not the LIMIT RPC.** The LIMIT ledger has `unique(order_id, execution_id)` and `unique(order_id, fill_sequence)`, with per-fill quantity, price, gross, allocated margin, charges, realized P&L and quote timestamp. The LIMIT fill RPC explicitly resolves only `order_type='LIMIT'`, checks a single best bid/ask and settles one fill at a time. It cannot be called repeatedly for a MARKET sweep: that would expose intermediate order/position/account states and each call assumes LIMIT-side executable-price semantics.
4. **Depth provenance is not yet persisted.** The current fill row records best bid/ask prices and quantities, but no depth level index, full-book snapshot hash, provider/source identity, or batch identity. A coordinated migration must decide which fields are persisted per fill versus once per MARKET order/snapshot, and must preserve deterministic fill IDs/sequences and exact retry payload comparison.
5. **Rounding contracts need an explicit decision.** The pure depth helper reports VWAP rounded half-up. The existing LIMIT SQL computes `average_fill_price_paise` using `floor(weighted_notional / filled_quantity)`. Position weighted-average entry is also floored. Do not silently mix these conventions. Keep exact aggregate notional and quantity as the authoritative calculation, then approve the order-receipt/display rounding and position-basis rounding separately.
6. **Margin and charges are not yet allocated across depth levels.** PR #106's scenario margin helper is not wired to MARKET or LIMIT accounting. Existing MARKET SQL takes a trusted provider margin amount for newly opened/reversed quantity; LIMIT SQL reserves opening margin and transfers it to position on fill, or releases position margin on close. A batch MARKET RPC must calculate closing quantity, reversal/opening quantity, margin reservation/release, realized P&L, and fees once at order scope, with deterministic per-fill allocation/rounding and conservation checks. It must not multiply the full order margin or charges by each depth level.

**Compatibility verdict:** the helper and existing Futures order/fill schema provide useful building blocks, but there is no approved or implemented multi-level MARKET accounting contract. PR #106 does not supply that contract. Required before implementation: accounting-owner approval for fill identity/schema extension, receipt/VWAP rounding, fee allocation, margin treatment, and atomic rollback/idempotency semantics. Until then, keep PR #109 simulation-only and do not add SQL/RPC wiring.

## 5. Idempotency and failure semantics

- Exact retry returns the original saved order and fill receipt without requesting a new quote or applying another accounting effect.
- Reuse of an idempotency key with a changed request fingerprint is a hard conflict.
- The same execution identity with changed level data or snapshot hash is a hard conflict.
- Quote validation, depth sweep, charges and margin estimation must finish before the atomic RPC call.
- If the atomic transaction fails, no fill, order, position, cash, margin or P&L mutation may remain.
- Provider timeout or incomplete depth must fail closed; never fall back to LTP or synthetic price.

## 6. Required test matrix

Pure helper tests:
- BUY multi-level ask sweep and SELL multi-level bid sweep;
- exact single-level compatibility;
- partial depth rejection and no mutation contract;
- price ordering, duplicate levels, zero/negative quantities, off-tick levels;
- crossed book, stale/future timestamp, instrument mismatch;
- integer overflow and VWAP rounding boundaries;
- ensure unused deeper levels are not included in the fill.

Gateway tests:
- exact instrument/session/quote checks precede provider execution;
- only provider-returned depth is used;
- provider error, malformed depth and insufficient depth reject before SQL;
- idempotent retry resolves saved receipt before provider quote access;
- no route path can write multiple fills outside the atomic RPC.

Disposable PostgreSQL tests (required before integration):
- all level fills and aggregate receipt commit together;
- rollback leaves no partial accounting when any level/constraint fails;
- long open, short open, long close, short close and reversal accounting;
- charges and margin conservation across multi-level fills;
- duplicate same-payload replay is a no-op; changed payload conflicts;
- concurrent same-key requests produce one order;
- concurrent MARKET close vs LIMIT fill/cancel obeys account → order → position locks;
- RLS, service-only grants and tenant isolation;
- existing LIMIT fill sequence/idempotency remains unchanged.

## 7. Rollout gates

1. Review this proposal with Futures Risk & Accounting (current candidate PR #106; PR #105 is superseded) and the Futures LIMIT/accounting owners.
2. Reconcile fill-ledger compatibility against the actual ordered migrations and hosted migration history; an open PR is not deployed schema.
3. Implement the pure depth-sweep helper and unit tests separately from database work.
4. Implement a coordinated atomic SQL batch RPC only after written accounting/margin approval.
5. Run full disposable PostgreSQL, gateway regression, race, RLS and tenant-isolation CI.
6. Keep feature flags disabled until staging rehearsal, provider data-rights review and operational sign-off.

**No approval is implied by this proposal.** This document does not authorize merge, production migration, deployment, or activation.


## 4B. MARKET route and provider-parser audit (2026-11-24)

Read the current PR #96 route implementation and its exact helper dependencies on branch `feature/nse-futures-order-engine-hardening-2026-11-23`. This is a read-only code audit; no route, parser, worker, or SQL file was changed.

1. **The REST parser currently discards all but level zero.** `extractUpstoxRestExecutableQuote` validates the Upstox V3 instrument token and timestamp, reads `depth.buy[0]` and `depth.sell[0]`, and returns only the best bid/ask price and quantity. It does not return or validate the remaining depth levels. The full raw provider response is available at the route boundary, but the normalized executable-book object is top-of-book only.
2. **The MARKET helper is also explicitly top-of-book.** `resolveFuturesMarketExecution` selects exactly one ask for BUY or one bid for SELL, checks that one level's tick and quantity, and calculates one-level gross. The MARKET route passes this one price and the complete requested quantity to the existing single-price RPC.
3. **The MARKET route has a sound pre-provider retry fast path that must be preserved.** It validates the request/contract and checks the user's existing order by idempotency key and fingerprint before loading the exchange session or requesting a new quote. An exact retry returns the saved receipt without depending on current provider availability; a changed request conflicts. A future batch path must preserve this behavior and return the persisted fill receipt, not re-sweep a new snapshot.
4. **Margin and charges are currently priced from the single selected best price.** For orders that may open/reverse exposure, the route requests Upstox margin for the full submitted quantity at `normalized.pricePaise`. It calculates trading charges from one `contractValuePaise` and sends one aggregate charge amount. With a multi-level sweep, the gross turnover must instead be based on the exact sum of each level's price × consumed quantity. The margin request's price basis (worst consumed price, provider-supported order-level quote, or another approved conservative rule) is unresolved and must be approved; do not assume the VWAP is conservative for margin.
5. **The existing fill schema is not a depth execution schema.** `paper_futures_fills` has one execution price/quantity and best bid/ask price/quantity fields, but no depth-level index, batch identity, full-snapshot hash, or provider/source identity. Its unique `(order_id, execution_id)` and `(order_id, fill_sequence)` constraints can support deterministic child rows only if the new batch contract defines their identity and sequence atomically. The current LIMIT RPC is restricted to LIMIT orders and cannot be reused once per level.
6. **Atomic integration must remain order-scoped for accounting.** The existing MARKET RPC locks account → idempotency/order identity → position and mutates the account/position once for the complete order. A future batch RPC should retain this single transaction boundary: validate all levels, calculate exact aggregate notional, close/reversal/open quantities, realized P&L, charges and margin once at order scope, then insert the complete set of immutable fills and one receipt. Per-level rows must not each apply the full order margin, full charges, or full position mutation.
7. **Recommended provenance split for owner review (not an approved schema).** Keep one immutable snapshot/batch header per order with provider/source identity, instrument key, snapshot timestamp, canonical full-book hash, and request fingerprint. Keep one child fill row per consumed depth level with deterministic sequence/index, exact price, consumed quantity, gross notional, and deterministic allocations. Decide whether to extend `paper_futures_fills` or introduce a MARKET-specific batch/header table only after the LIMIT/accounting owners approve compatibility, RLS, retention and reconciliation semantics. Do not duplicate the full book payload into every fill unless audit/replay requirements justify it.

**Implementation consequence:** this is not just a change to the sweep helper. The next executable slice requires (a) an additive full-depth provider parser contract with top-of-book compatibility for existing LIMIT consumers, (b) a MARKET-specific immutable batch receipt/fill contract, and (c) a new service-only atomic SQL transaction with approved margin/charge/rounding rules. Until those approvals exist, keep the current parser, route, MARKET RPC, LIMIT RPC, and schema unchanged.
