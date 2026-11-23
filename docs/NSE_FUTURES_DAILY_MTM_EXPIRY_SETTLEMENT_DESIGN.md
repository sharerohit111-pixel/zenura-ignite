# NSE Futures Daily MTM and Final Expiry Settlement — Design Gate

**Date:** 2026-11-23  
**Status:** Design only; no settlement RPC or migration is authorized by this document.  
**Scope:** NSE Futures Paper Trading only. This is not exchange connectivity or live trading.

## 1. Current-state boundary

The existing Futures MARKET/LIMIT transactions book trade-close realized P&L, charges, cash and margin reservations. The portfolio layer computes quote-based unrealized P&L. Neither is an exchange daily mark-to-market (MTM) cash settlement.

The current expiry worker expires pending LIMIT orders and releases their remaining order reservation at a configured cutoff. It does not settle an open position at the official final settlement price. Do not label pending-order expiry as contract settlement.

## 2. Required trusted input

A settlement price is executable only as a verified immutable snapshot with:

- NSE exchange and exact derivative instrument identity from the approved instrument master (instrument key/token, trading symbol, segment, expiry, lot size and tick size).
- Settlement kind: `DAILY` or `FINAL_EXPIRY`.
- Exchange business date in `Asia/Kolkata`, official price in integer paise, source reference, source SHA-256, ingestion timestamp and verifier identity.
- Source allowlist restricted to official NSE publication endpoints; reject arbitrary URLs, stale/future snapshots, mismatched contract identity, off-tick prices and duplicate/conflicting source revisions.
- No browser-supplied settlement price, margin, quantity, P&L or user identity.

Missing, late, conflicting or unverifiable official prices must fail closed. No fallback to last quote, LTP, close quote or broker margin preview.

## 3. Daily MTM accounting semantics

For a signed open quantity (q) (long positive, short negative), prior official settlement basis (S_{prev}), and today's official settlement (S_t):

`variation_paise = q * (S_t - S_prev)`

Use numeric intermediate arithmetic, validate bigint bounds, and round only where the exchange's published contract convention requires it. Since prices are stored in paise and quantity is integral, the raw variation is integer paise.

Within one transaction, per account and contract:

1. Lock the shared paper account first, then the position, then the settlement identity row in a globally consistent lock order. Revalidate contract identity and signed quantity after locks.
2. Require a prior official settlement basis. For a position opened after the prior settlement, its initial basis is the actual weighted average execution price; the opening-day variation must follow the explicitly approved exchange convention and must not be inferred from an LTP.
3. Post variation exactly once to virtual cash; record a distinct daily-MTM ledger event. Do not add it to trade-close realized P&L or rewrite order realized P&L.
4. Advance the position's settlement basis to (S_t), preserve quantity and reserved margin, and increment account version.
5. Persist immutable input snapshot, old/new basis, signed quantity, variation, account cash before/after and deterministic idempotency identity.
6. An exact replay returns the original result without another cash mutation. Same identity with changed quantity, price, date, source hash or contract data is a conflict.
7. A failed posting leaves cash, basis and settlement status unchanged.

The UI must distinguish **Trade Realized P&L**, **Daily MTM Cash Settled**, and **Current Unrealized P&L**. Daily settled variation must not be counted again in unrealized valuation.

## 4. Final expiry settlement semantics

Final expiry settlement is a separate terminal transaction, never a daily-MTM flag or a market close order.

1. Require the official NSE final settlement price for the exact expiring contract and exchange business date, verified against the contract master and tick size.
2. Lock account, position and settlement identity; reject if contract expiry/date identity does not match or if final settlement already exists.
3. Compute final variation from the last official daily settlement basis (or approved initial basis if no daily settlement has occurred) to the official final price using the signed open quantity.
4. Post final variation exactly once to cash, write a distinct final-settlement ledger event, and record the final price/source snapshot.
5. Release the entire remaining position margin exactly once from account reserved margin; do not release margin belonging to another contract or pending order.
6. Terminalize the position with an auditable closed/settled record rather than silently deleting the only evidence. Preserve original quantity, signed direction, basis, final price, final variation, released margin and settlement reference.
7. Ensure pending LIMIT orders for the contract are separately expired/cancelled and their unfilled opening margin or close-quantity reservations released atomically or in a separately idempotent, retry-safe transaction. Never settle an order's pending reservation as position margin.
8. Replays are no-ops only for an exact payload match; conflicting final price/source/quantity is a hard conflict. No reopen or new fill is permitted after final settlement.

## 5. Conservation and invariants

- Account cash delta equals the sum of posted Futures settlement variations and remains non-negative under the simulator's explicit policy.
- Account reserved margin equals the sum of open Futures position margin plus other already-accounted derivative reservations; final settlement releases only the settled position's exact residual.
- Position quantity is unchanged by daily MTM and becomes terminal only through final expiry settlement or a separately defined user close transaction.
- Every settlement event is unique by user, instrument identity, expiry, settlement kind and exchange business date; final expiry is unique per contract.
- Immutable settlement events reconcile to account cash deltas; no update/delete access for clients.
- Trade realized P&L, daily variation cash, final variation cash, charges and margin movements remain separate ledger dimensions. No double counting in equity/net-liquidation views.
- Account-first lock ordering must match MARKET/LIMIT order RPCs. All functions are service-role-only with empty search_path, explicit grants and RLS deny-by-default.
- All writes are simulation-only and require integer-paise arithmetic.

## 6. Required schema/RPC design before implementation

Proposed objects (names provisional; reconcile with existing ledger conventions before coding):

- Immutable verified settlement-price snapshot table keyed by exact instrument/expiry/kind/date/source revision.
- Immutable settlement event table with unique idempotency key and unique contract/date/kind identity.
- Position settlement-basis fields: previous official settlement price, settlement date, and initial-basis provenance.
- Atomic service-role RPC for daily MTM settlement.
- Separate atomic service-role RPC for final expiry settlement.
- Separate audit/reconciliation query proving account cash and margin totals against immutable events and open positions.

Do not create one generic RPC with a caller-controlled settlement kind unless the function enforces distinct state transitions and constraints internally. Do not use a user-supplied timestamp as the source of exchange date.

## 7. Regression test matrix (disposable PostgreSQL only)

### Daily MTM
- Long profit, long loss, short profit, short loss.
- Multi-day basis roll-forward; same-day duplicate replay.
- Exact replay no double cash credit/debit; changed payload conflict.
- Multiple users holding same contract remain isolated.
- Two concurrent settlement attempts produce one event and one cash mutation.
- Position quantity and margin unchanged.
- Missing/invalid/stale/unverified/wrong-contract/off-tick settlement price rejected without mutation.
- Bigint overflow and negative available cash policy rejected atomically.
- Daily MTM cash event is not double-counted in quote-based unrealized P&L.

### Final expiry
- Long and short final variation, positive/negative/zero result.
- Position terminalization and exact residual margin release.
- Partial-close history and prior daily settlement basis respected.
- Pending LIMIT order expiry and reservation release do not collide with position margin release.
- Duplicate final settlement replay no-op; conflicting final price rejected.
- Concurrent final settlement vs close/fill/expiry worker serialized by account-first locks.
- Missing official final price leaves position and reservations untouched.
- Post-settlement fills/reopens for the expired contract rejected.

### Security and integration
- anon/authenticated cannot execute RPCs or mutate settlement tables.
- Service role only; RLS and grants verified.
- Two-connection race tests and rollback-only fixtures.
- Existing Futures MARKET/LIMIT accounting, Options shared lease namespace and Equity/Options execution paths remain unchanged.
- Disposable migration ordering verified; no production or staging migration in this phase.

## 8. Release gates

1. Approve settlement price source contract and official NSE data provenance.
2. Approve opening-day basis and rounding/accounting conventions.
3. Implement schema and RPCs on a separate feature branch after design review.
4. Pass the full disposable PostgreSQL test matrix, including concurrency.
5. Reconcile shared account margin and ledger invariants across Futures and the existing derivative accounting model.
6. Complete non-production end-to-end and worker-recovery rehearsal.
7. Keep all Futures worker/submit flags disabled until explicit release approval.

**This document is not evidence that daily MTM or final expiry settlement is implemented.**
