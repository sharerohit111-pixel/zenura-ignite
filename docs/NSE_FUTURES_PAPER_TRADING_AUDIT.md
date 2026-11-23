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

The Futures LIMIT worker uses the dedicated state key `paper_futures_limit_orders`, while the Futures implementation baseline's shared lease RPC only accepts equity LIMIT and protective-order keys. This prevents the Futures worker from acquiring its lease.

This branch adds a forward-only migration allowing the Futures key while explicitly preserving the existing equity LIMIT, intraday LIMIT and protective keys. It also retains the 5–300 second TTL bounds, safe-integer millisecond timestamp validation, owner-token check and service-role-only grants. The rollback-only SQL regression checks exclusive ownership, wrong-owner release rejection, owner release, idempotent release, reacquisition, preservation of existing worker keys, unsafe timestamp rejection and RPC grants.

A separate Options development branch contains a broader derivative lease-key migration that also adds an Options key. This Futures-only branch intentionally does not change or import Options code; integration should reconcile the shared lease migration rather than blindly applying duplicate allowlist migrations.

## Remaining release gates

1. Run the new lease regression and the complete Futures SQL migration suite in disposable PostgreSQL CI; do not treat source inspection as a passing runtime test.
2. Run the gateway Futures worker/unit suite and confirm the CI run for the exact commit is green.
3. Verify end-to-end submit/list/cancel API behavior against a disposable Supabase project, including user ownership and worker opt-in/disabled states.
4. Confirm the worker's dedicated cursor/lease behavior under restart, lease expiry and partial batch failure.
5. Add and validate a separate Futures expiry settlement design before claiming expiry settlement support. Pending-order expiry is not contract settlement.
6. Confirm broker margin/charges and market-data licensing assumptions with approved provider data; no live exchange order execution is part of this paper simulator.

## Safety boundary

The worker remains disabled unless its explicit environment flag is enabled; submission is separately gated. This change does not enable either flag. No production Supabase migration or Cloud Run deployment was run. Equity, Options and Crypto execution source files are not changed by this work.


## Additional worker lease finding (follow-up source review)

The Futures LIMIT worker currently acquires a 240-second lease and releases it in a `finally` block, but the worker lease RPC pair exposes only acquire/release; there is no owner-checked renewal RPC wired into this worker. The gateway's process-local `workerBusy` guard prevents overlapping cycles only inside one process and does not protect against a second gateway instance acquiring the lease after TTL expiry while the first cycle is still running.

The existing generic `createLeaseHeartbeat` helper is used for a different market-stream lease and cannot safely renew this worker lease because the market-worker SQL API has no renewal operation. Do not reuse the stream renewal RPC or extend shared worker lease functions in this isolated Futures change without coordination with the Options/other worker branches: the lease functions and allowlist are shared infrastructure, and the Options branch already has an overlapping migration.

**Required before enabling the Futures worker in a multi-instance deployment:** coordinate a service-role-only, owner-token-checked market-worker lease renewal RPC (including TTL and safe timestamp validation), reconcile the Futures/Options allowlists into one migration, add lease-loss handling that stops new fills, and test renewal-vs-expiry/reacquisition races in disposable PostgreSQL. Until then, keep `PAPER_FUTURES_LIMIT_WORKER_ENABLED` disabled in multi-instance environments. The current 240-second TTL is not proof of safe long-running ownership.
