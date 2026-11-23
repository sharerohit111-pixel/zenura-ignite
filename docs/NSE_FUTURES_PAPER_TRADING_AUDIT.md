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

## Settlement and risk-engine gaps

The current `calculateDerivativePortfolio` path is quote-based unrealized valuation using fresh quotes and a fresh broker margin snapshot. It does not post exchange daily settlement variation to the cash ledger, reset a daily settlement basis, or create a daily MTM ledger event. The Futures close transaction books realized trade P&L; that is not a substitute for exchange daily MTM.

The current expiry handling expires unfilled LIMIT orders and releases their remaining order reservation at the configured cutoff. It does not close open Futures positions at an official final settlement price, post final variation cash, release all position margin through a settlement transaction, or create an exactly-once contract settlement record.

Before implementing either settlement flow, define trusted official settlement-price ingestion, instrument/expiry identity, session and date boundaries, rounding rules, cash and margin ledger invariants, idempotency keys, replay/recovery behavior, and missing-price fail-closed behavior. Daily MTM and final expiry settlement must be separate, auditable transactional operations. Paper-only margin shortfall/forced liquidation also remains a separate unimplemented risk-engine capability.

## Blocking finding and isolated fix

The Futures LIMIT worker uses the dedicated state key `paper_futures_limit_orders`, while the Futures implementation baseline's shared lease RPC only accepts equity LIMIT and protective-order keys. This prevents the Futures worker from acquiring its lease.

This branch adds a forward-only migration allowing the Futures key while explicitly preserving the existing equity LIMIT, intraday LIMIT and protective keys. It also retains the 5–300 second TTL bounds, safe-integer millisecond timestamp validation, owner-token check and service-role-only grants. The rollback-only SQL regression checks exclusive ownership, wrong-owner release rejection, owner release, idempotent release, reacquisition, preservation of existing worker keys, unsafe timestamp rejection and RPC grants.

A follow-up migration adds service-role-only `renew_paper_market_worker_lease`. Renewal is an atomic owner-token-and-unexpired-lease update; a wrong owner or already-expired token returns false and cannot resurrect the lease. The Futures worker renews every 60 seconds against its 240-second TTL, stops starting further fills if renewal fails or ownership is lost, and skips cursor persistence after lease loss. The renewal SQL regression covers owner mismatch, successful expiry extension, expired-token rejection, timestamp bounds and grants.

A separate Options development branch contains a broader derivative lease-key migration that also adds an Options key. This Futures-only branch intentionally does not change or import Options code; integration should reconcile the shared lease migration rather than blindly applying duplicate allowlist migrations.

## Remaining release gates

1. The gateway Futures worker/unit suite and the disposable PostgreSQL migration/race suite have passed on the latest code commit (GitHub Actions run #1200, commit `84eb5c3294b2751ff086c7855d2710150cb75230`). This is CI evidence only.
2. Verify end-to-end submit/list/cancel API behavior against a disposable Supabase project, including user ownership and worker opt-in/disabled states.
3. Rehearse worker restart, lease expiry, lease loss and cursor recovery in a non-production staging environment after reconciling the shared Futures/Options lease migration.
4. Design and validate Futures daily MTM cash settlement and final contract-expiry settlement before claiming either capability. Pending LIMIT expiry is not contract settlement.
5. Design and test paper-only margin shortfall handling and forced-liquidation simulation; current fresh broker margin snapshots are used for valuation/preview, not an automated liquidation engine.
6. Confirm broker margin/charges and market-data licensing assumptions with approved provider data; no live exchange order execution is part of this paper simulator.

## Safety boundary

The worker remains disabled unless its explicit environment flag is enabled; submission is separately gated. This change does not enable either flag. No production Supabase migration or Cloud Run deployment was run. Equity, Options and Crypto execution source files are not changed by this work.


## Worker lease review and fail-closed status

The original Futures LIMIT worker had an acquire/release-only lease and could lose single-writer protection after the 240-second lease TTL. This branch adds a service-role-only owner-bound renewal RPC and renews the worker lease every 60 seconds against a 240-second TTL. Expired or non-owner tokens cannot renew, and the two-connection renewal-versus-reacquisition race test verifies that neither a stale renewal nor a competing acquisition steals an active lease.

The worker stops starting new fills after heartbeat loss, skips cursor persistence after lease loss or any failed fill, and now also stops before cursor reset/read continuation or order-expiry side effects when the heartbeat reports ownership loss. Regression tests cover lease loss during quote/session processing. Lease release remains owner-token-bound in the worker's `finally` cleanup.

Disposable CI run #1200 passed the complete gateway regression suite, ordered draft migrations, Futures ledger/accounting tests, Futures LIMIT lifecycle and partial-fill conservation, duplicate/fill-cancel races, lease ownership/renewal/expiry tests, and the two-connection renewal/reacquisition race. This does not replace a staging multi-instance rehearsal.

**Activation remains blocked:** keep `PAPER_FUTURES_LIMIT_WORKER_ENABLED` disabled until the Futures/Options shared lease migration is reconciled into one canonical integration migration and non-production staging validation passes. The submission flag remains separately gated.

## Follow-up worker session regression fix

Source review found that the Futures LIMIT worker treated every non-open session as an expiry condition. That incorrectly expired pending orders when the verified calendar was missing, before the verified open, or on a verified non-trading day. The isolated worker now distinguishes `MISSING`, `BEFORE_OPEN`, `NOT_TRADING_DAY`, `OPEN` and `CLOSED`: it preserves pending orders for the first three states, processes eligible quotes only during `OPEN`, and invokes order expiry for a verified `CLOSED` session or the existing explicit order/contract expiry cutoffs. Regression cases cover each of these boundaries.

## Options/Futures shared lease migration coordination

The Options PR #91 migration `20261123220000_derivative_limit_worker_lease_keys.sql` already allowlists both `paper_futures_limit_orders` and `paper_option_limit_orders`, along with existing worker keys. The Futures-only migration in this branch was authored independently against its older base and is therefore a duplicate definition of the same shared RPC pair with a narrower allowlist. During integration, use one reconciled canonical migration (the combined allowlist from the coordinated Options/Futures integration) and do not apply both definitions as independent final states. This does not resolve the missing renewal RPC; that remains a multi-instance release blocker.


## Latest disposable CI verification

GitHub Actions run #1200 passed on commit `84eb5c3294b2751ff086c7855d2710150cb75230`. It ran the complete market-gateway regression suite, built the Supabase-native gateway container, applied ordered draft migrations to disposable PostgreSQL, and passed Futures MARKET accounting, Futures LIMIT submit/reservation/cancel/expiry, partial-fill settlement conservation, concurrent fill/cancel/duplicate execution races, isolated worker lease ownership/grants, owner-bound renewal/expiry, and two-connection renewal/reacquisition races. The added worker regression also verifies that lease loss during session lookup prevents order-expiry side effects. This is disposable CI evidence only; it does not authorize production migration, deployment, activation, or replace a staging multi-instance rehearsal.
