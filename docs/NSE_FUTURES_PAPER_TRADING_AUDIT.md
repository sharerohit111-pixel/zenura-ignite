# NSE Futures Paper Trading — Technical Audit

**Audit date:** 2026-11-23  
**Scope:** NSE Futures only. Crypto, Equity execution and Options execution are outside this change.  
**Environment policy:** source and disposable-CI changes only; no production migration, deployment, or data mutation is authorized.

## Repository baseline

- Repository: `sharerohit111-pixel/zenura-ignite`
- Existing implementation baseline: `feature/indian-market-futures-limit-atomic-fill` at `4777e8111a93cd47238c4c0e3f70af300605e40b`
- Work branch: `feature/s-trade-nse-futures-worker-lease-2026-11-23`
- Architecture: Supabase PostgreSQL transactional RPCs, Supabase-native market gateway, Upstox REST quotes/instrument master, Node test suite and disposable PostgreSQL CI.

## Verified implementation

| Area | Source-level finding |
|---|---|
| MARKET | `execute_paper_futures_market_order` is an atomic transaction and records a terminal MARKET receipt. |
| Direction | Signed Futures position quantity supports long and short exposure, partial close, full close and reversal. |
| Margin | Provider-derived opening margin is reserved; proportional close releases margin, with final close consuming the exact residual. LIMIT pending margin is tracked separately from position margin. |
| Leverage | Margin is simulated from trusted broker/provider margin snapshots; it is not a user-selectable exchange leverage facility. |
| Realized P&L | Long and short close P&L is booked to order, position and account ledgers. |
| Charges | MARKET and LIMIT charge calculations exist; LIMIT worker derives incremental charges from cumulative turnover to avoid repeating brokerage caps across partial fills. |
| LIMIT state | Dedicated LIMIT submit, cancel, expiry and atomic fill RPCs exist, with PENDING/PARTIALLY_FILLED/FILLED/CANCELLED/EXPIRED lifecycle. |
| Partial fills | Immutable fill rows, weighted average fill price, integer-paise margin transfer, quantity conservation and final residual allocation are implemented. |
| Idempotency | Submission idempotency key/fingerprint and per-order execution ID/sequence uniqueness are enforced in SQL. Exact fill replay is a no-op; changed payload replay conflicts. |
| Concurrency | Writers use account → order → position lock order. A dedicated SQL race harness covers fill-vs-cancel and duplicate execution delivery. |
| MTM | `calculateDerivativePortfolio` computes Futures unrealized P&L from signed quantity and fresh quotes, and requires a fresh broker margin snapshot. Futures notional is excluded from derivative market-value total. This is valuation MTM, not exchange daily settlement. |
| Expiry | Pending LIMIT orders are expired and residual reservation released at the configured order/contract cutoff. No verified Futures exchange settlement/expiry payout engine was found. |

## Blocking finding and isolated fix

The Futures LIMIT worker calls the shared lease RPC using state key `paper_futures_limit_orders`, but the existing lease RPC allowlist accepts only `paper_limit_orders` and `paper_protective_orders`. Consequently the Futures worker cannot acquire its lease and fails closed before scanning orders.

This branch adds a forward-only migration to allow the dedicated Futures state key in both acquire and release RPCs. It preserves the existing lease TTL bounds, owner-token check, and service-role-only grants. A disposable SQL regression verifies exclusive ownership, wrong-owner release rejection, owner release, re-acquisition and grants.

## Remaining release gates

1. Run the new lease regression and the complete Futures SQL migration suite in disposable PostgreSQL CI; do not treat source inspection as a passing runtime test.
2. Run the gateway Futures worker/unit suite and confirm the CI run for the exact commit is green.
3. Verify end-to-end submit/list/cancel API behavior against a disposable Supabase project, including user ownership and worker opt-in/disabled states.
4. Confirm the worker's dedicated cursor/lease behavior under restart, lease expiry and partial batch failure.
5. Add and validate a separate Futures expiry settlement design before claiming expiry settlement support. Pending-order expiry is not contract settlement.
6. Confirm broker margin/charges and market-data licensing assumptions with approved provider data; no live exchange order execution is part of this paper simulator.

## Safety boundary

The worker remains disabled unless its explicit environment flag is enabled; submission is separately gated. This change does not enable either flag. No production Supabase migration or Cloud Run deployment was run. Equity, Options and Crypto source files are not changed by this work.
