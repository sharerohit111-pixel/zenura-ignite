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
