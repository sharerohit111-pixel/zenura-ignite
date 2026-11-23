# Futures Risk & Accounting Audit

**Scope:** NSE Futures paper-trading risk/accounting only. This document is a code audit and simulation design record; it does not authorize production migrations, deployments, feature activation, or live trading.

## Repository baseline

- Repository: `sharerohit111-pixel/zenura-ignite`
- Audit base: `feature/s-trade-nse-futures-worker-lease-2026-11-23`
- Work branch: `feature/s-trade-futures-risk-accounting-2026-11-23`
- Existing Futures chain: PR #87 schema, PR #88 submit/release, PR #89 atomic partial fills, PR #93 dedicated worker lease. All were open Draft PRs at audit time; do not imply they are merged or deployed.
- Existing main Futures MARKET transaction: `execute_paper_futures_market_order` in `20261122120722_futures_market_order_transaction.sql`.
- Existing account and position money is stored in integer paise.

## Verified existing behavior

1. MARKET execution accepts a trusted server-provided margin amount, validates a fresh provider quote and expiry cutoff, and serializes writes with account → idempotency/order → position locks.
2. Positions use signed net quantity; opposite-side fills close existing exposure first and can reverse the position only when a positive margin amount is supplied for the new exposure.
3. Account-level `reserved_margin_paise` is updated atomically with position-level `reserved_margin_paise`; close margin release is proportional with exact residual release on full close.
4. MARKET execution debits charges and credits/debits realized P&L to virtual cash, and stores a FILLED order receipt. The disposable SQL test reconciles account realized P&L to order receipts and account margin to open-position margin.
5. LIMIT work adds separate pending opening-margin and close-quantity reservations, an immutable fill table, atomic submit/cancel/expiry and partial-fill RPCs. Partial opening fills transfer reservation from order to position; close fills release position margin.
6. LIMIT submit/fill use the same account → order → position lock sequence, idempotent execution identity, verified session and executable quote-side checks. The dedicated worker lease remains a separate concurrency primitive, not an accounting lock.
7. Portfolio MTM currently computes signed quantity × (current quote − average entry price). It withholds aggregate unrealized P&L/equity when any open-position quote is stale or unavailable.

## Gaps / not established by the inspected implementation

- Existing `reserved_margin_paise` is a persisted provider-supplied reservation amount; it is not a separately versioned simulation initial-margin model and must not be labelled as NSE/SPAN/official margin.
- The inspected portfolio endpoint labels margin status as `entry_estimate`; no complete available/used/maintenance margin risk snapshot was found.
- No durable prior-settlement price/basis and daily variation-margin posting lifecycle was verified.
- No complete Futures expiry settlement workflow with an explicit authoritative settlement-price source, settlement ledger, idempotent close and margin release was verified.
- No automatic liquidation simulation workflow was verified. A maintenance breach signal must remain distinct from execution; no automatic close should be implied.
- Position rollover/next-contract transfer is not verified. Futures contracts must not be silently carried into a different expiry/instrument key.
- A provider margin preview is a read-only preview and is not itself a durable reservation or exchange guarantee.

## Simulation design boundary

- Keep provider/exchange margin snapshots explicitly labelled with their provider/source timestamp and contract context.
- Keep configurable scenario initial/maintenance rates in a separate model named `CONFIGURABLE_SIMULATION`; never silently fall back from missing exchange/provider data to a guessed rate.
- Use integer paise and signed integer quantities for all accounting. Reject unsafe integer arithmetic.
- Mark-to-market is signed quantity × (mark − basis). Daily variation is signed quantity × (today settlement − prior settlement), then the settlement basis advances only after an idempotent settlement posting.
- Maintenance breach is a risk state, not an exchange liquidation notice. A liquidation simulation requires a separately authorized simulation policy and must not submit a real broker order.
- Expiry settlement requires an explicit settlement price and provenance. Do not derive it from LTP, chart close, or a payoff helper.
- Rollover is two distinct simulated legs (close old contract, open new contract), each with its own contract validation, margin requirement, charges and idempotency identity.

## Shared-component boundary

Do not modify common account schema, generic worker leases, Equity/Options code, common market gateway routing, shared auth/RLS, or PR #93 lease functions without cross-chat coordination. Follow-up persistent accounting changes should be limited to Futures-specific migrations/RPCs/tests and reviewed against the existing global account lock order.


## Live Supabase project verification (read-only, 2026-11-23)

Project `atvbjibhunvzpmfagagm` is `ACTIVE_HEALTHY` on PostgreSQL 17.12. The live migration history currently ends at `20261122123415_paper_market_worker_lease_timeout`; the later GitHub Futures LIMIT ledger/atomic-RPC work was not present in the hosted migration history at audit time. Do not assume an open PR branch has been applied to Supabase.

The live database already contains `paper_futures_orders` and `paper_futures_positions`:
- Position quantity is signed and constrained to non-zero values with an absolute cap of 1,000,000.
- Position margin and account reserved margin are non-negative.
- Account constraint enforces `reserved_cash_paise + reserved_margin_paise <= cash_paise`.
- Orders have unique idempotency per user and an explicit `simulation_only IS TRUE` constraint.
- Futures order and position tables have RLS enabled with authenticated SELECT-own policies. No direct authenticated INSERT/UPDATE/DELETE policy was found.
- The live MARKET RPC is `SECURITY DEFINER`, has an empty search_path, and its ACL is restricted to `postgres` and `service_role`; no authenticated/public EXECUTE grant was found.
- No Futures risk/settlement/variation-margin ledger table or daily settlement/liquidation RPC was found in the inspected public schema.
- No triggers were found on the three inspected account/Futures tables; current conservation is therefore maintained by transaction RPCs rather than table triggers.

## Consequences for next implementation

1. Do not apply DDL directly to the hosted project while the GitHub migration chain is still being reconciled.
2. First reconcile the open Futures LIMIT PR chain and its migration files with the actual hosted migration history. The hosted project has not yet recorded those later migrations.
3. Create the next migration using the repository's pinned Supabase CLI workflow (the CLI must be checked with `supabase --version` and `supabase migration new --help`; CLI v3 changes remote defaults and hosted-write confirmation behavior). Do not invent a timestamp or assume a local command's default target.
4. Add a Futures-only ledger with append-only, uniquely idempotent events for margin reservation/release, realized close P&L, daily variation settlement, expiry settlement, and simulation liquidation. Store contract key, expiry, signed quantity, price basis, event type, source/provenance, model/version, and paise deltas.
5. Each mutating RPC must lock account first, then its event/idempotency identity, then position, matching the existing global lock order. The event insert, cash/margin/position update, and account version increment must commit atomically.
6. Required conservation checks:
   - Account reserved margin = sum of open Futures position margin + pending Futures opening-order reservation.
   - Per-position margin = initial allocated margin + subsequent margin additions − releases, never below zero.
   - Each event idempotency key maps to exactly one immutable payload and one accounting effect.
   - Daily variation postings sum to signed quantity × (settlement price − prior settlement price); after posting, the settlement basis advances exactly once.
   - Expiry closes the exact signed open quantity, realizes the final basis-to-settlement P&L, releases all residual position margin, and leaves no open expired contract.
   - Simulated liquidation is an explicitly labelled paper event; it never routes to a broker.
7. Because public-schema Data API auto-exposure defaults changed in 2026, every new public table must explicitly define RLS and deliberate grants. Do not rely on automatic exposure or broad authenticated table writes.

## Supabase platform compatibility note

The project is PostgreSQL 17.12. Supabase's 2026 changelog documents that public tables are no longer automatically exposed to the Data API by default (enforced across projects from 2026-10-30), and CLI v3 changes database commands to local-by-default with explicit hosted confirmation. Any future schema PR must explicitly handle grants/RLS and use the repository's pinned CLI version and documented remote workflow.
