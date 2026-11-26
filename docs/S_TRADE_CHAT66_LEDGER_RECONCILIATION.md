# S-TRADE Chat 66 — Financial Ledger Reconciliation Evidence

**Audit date:** 2026-11-26  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Audit base:** PR #245 current inspected head `2e400f67cc1f5548441c8fa499584a9913d43fd3`  
**Decision:** **BLOCKED — keep `ledgerReconciled=false`.**  
**Scope:** Indian Market Paper Trading only. This document is an evidence register, not a reconciliation attestation.

## 1. Safety and scope

No production or staging writes, migrations, deployments, broker activity, Crypto changes, merges, or balance adjustments were performed. No opening balance, transaction, fill, fee, charge, settlement, reversal, receipt, or historical event has been synthesized.

At the time this Chat 66 continuation branch was created, its base was the then-current PR #245 head `2e400f67cc1f5548441c8fa499584a9913d43fd3`. The older PR #245 head `98d7c300d33a7d9307ecc14fe93542ca500f08e6` appears in earlier audit notes and is not the base of this continuation.

## 2. Canonical event architecture inspected

At PR #245 head, `markets/shared/paper-demo-event-ledger.mjs` is schema **1.2.0** and defines one Demo ledger for the three engines (EQUITY, FUTURES, OPTIONS), with account/session scope, event IDs, idempotency/source IDs, sequence numbers, timestamps, integer-paise deltas, immutable cloned events, replay, and derived order/fill/position projections.

The inspected event-type allowlist is:
- `ORDER_ACCEPTED`, `ORDER_UPDATED`, `ORDER_REJECTED`
- `FILL_RECORDED`
- `RESERVATION_CHANGED`
- `POSITION_CHANGED`

This is a **synthetic browser Demo event ledger**, not proof that the authenticated persisted Equity/Futures/Options SQL accounting ledgers have been unified. The Demo ledger's Equity fill cash delta is constrained to signed gross notional; it does not by itself prove fee/tax/charge posting, reversals/refunds, dated T+1 cash settlement, or a durable cross-asset database snapshot. F&O fill cash and blocked-fund deltas are rejected without a settlement receipt.

## 3. Relevant PRs and exact refs inspected

| PR | Head SHA | Status / relevance |
|---|---|---|
| #245 | `2e400f67cc1f5548441c8fa499584a9913d43fd3` | Exact base SHA used by this Chat 66 continuation branch; Draft mainline integration candidate |
| #179 | `7314c1a6b0d5dfe9bc9a34d67e80159d01694961` | Draft shared Demo ledger/session; synthetic Equity/Futures/Options projections; wallet reconciliation explicitly excluded |
| #203 | `9db7f3cb00ed89f7a45381cb3ef45fe6981f985e` | Draft clean-port of schema/replay/terminal guards; exact-head CI was pending in its recorded evidence |
| #205 | `6082d19ece570921a3d7b07d0d97042edc1a27c2` | Draft event invariants; exact fill gross and blocks derivative wallet cash without authoritative receipts |
| #187 | `7e9d6f3b3b1aeae4110e4047519c2895570e9361` | Draft F&O receipt validation boundary; explicitly lacks production issuer/key trust and cryptographic verifier |
| #192 | `08c2c17272b41e8a7bdcca8ec1bc05d09ab19d2f` | Draft closes generic settlement append bypass; trust/cryptographic proof still absent |
| #196 | `f8b307e3c272e6f709333ac0eb3f2fd902033a8c` | Draft binds F&O receipt to canonical order/fill; real trusted issuer/key registry remains absent |
| #208 | `dff564ec42d9721d4623a5205344f268fff93e22` | Draft duplicate Options fill-settlement and terminal Futures reservation guards |
| #213 | `c4d58c331951850c36219ef8309609213cc916a8` | Draft fail-closed rule: generic events cannot move cash/blocked funds absent verified settlement path |
| #158 | `c3a8fd5e46ee3040f6844e1b97f670b152132062` | Draft portfolio read model; lifetime completeness is not ledger reconciliation |
| #100 | `ea2a8b45dfd6770e881ca51a38c012d55ef803f7` | Draft Equity ledger; partial fills, reversal/refund, full reconciliation and T+1 remain follow-ups |
| #129 | `fa48f18e58bbdc7bfd6b4a289bcdc21427d6e8e8` | Draft Options read model/receipts; official settlement authenticity and atomic cross-table snapshot remain blockers |
| #135 | `3d59ef53022ca5ac9974f31eddd81e528b621186` | Draft Futures margin/settlement; official settlement ingestion worker and verified maintenance-margin source remain blockers |

These PRs are independent or stacked drafts on different bases. They must not be treated as one deployed or merged implementation. No PR was merged or rebased in this audit.

## 4. Lifecycle reconciliation matrix

| Lifecycle item | Evidence available | Reconciliation result |
|---|---|---|
| Opening cash | PR #131 describes idempotent ₹10,00,000 account initialization; Demo ledger opening cash is a supplied session input | Not proven against a complete immutable persisted event history |
| Equity BUY/SELL fills | Equity accounting PR #100; Demo fill gross and cash-direction checks | Gross notional checks exist; full fee-inclusive persisted cash/position/receipt conservation not proven |
| Reservations | Equity LIMIT and F&O reservation SQL work exists across separate drafts; Demo SELL-share reservation projection exists | No single cross-asset authoritative reservation journal/snapshot proven |
| Partial fills | Demo ledger lifecycle guards and separate F&O SQL test evidence | Production Equity partial fills are explicitly absent in #100; all asset classes not proven under one ledger |
| Cancel/reject/expiry | Separate engine and SQL branches have terminal/cancel/expiry protections | End-to-end cross-asset cash, blocked-funds and reservation conservation is not proven |
| Fees/charges | Options charge components and separate fee masters exist; Demo fill payload is gross-focused | Full lifetime charge source coverage and exact cash/realized-P&L linkage not proven across all assets |
| Reversals/refunds | Equity #100 lists refund/reversal RPC as follow-up | Missing authoritative complete reversal lifecycle |
| Futures margin / daily MTM | Draft #135 journal and service-role RPC design | Official source ingestion and full wallet reconciliation not proven |
| Options settlement | Draft receipt validator and order/fill binding follow-ups | Trusted issuer/key registry and cryptographic verification absent |
| Duplicate replay | Demo event idempotency/replay checks; separate SQL idempotency tests | Not independently proven against one complete durable cross-asset persisted ledger |
| Immutable receipts | Demo fill snapshots and F&O receipt validation boundary | Not all receipt issuers, signatures, event references and lifecycle facts are independently trusted |
| Unrealized P&L | Read-model math and synthetic marks | Synthetic-only; stale/unpriced marks suppress aggregate value; not an authoritative current-market valuation |
| Realized P&L / cost basis | Asset read models and position projections | Lifetime source completeness and conservation across every fill/charge/reversal/settlement not proven |

## 5. Settlement receipt trust boundary

The inspected settlement receipt module on PR #187 validates account/session/order/asset/side scope, issuer membership in a supplied allowlist, receipt/event replay identifiers, amount direction, and a callback-based attestation check. The callback is an injected verifier seam. The PR explicitly states that the production trusted issuer registry, key resolution, and cryptographic verifier are not implemented.

Follow-up PRs #192, #196, #208 and #213 harden append bypasses, order/fill binding, duplicate settlement, terminal reservations, and fail-closed cash movement. These controls do **not** turn the injected verifier into an independently trusted production cryptographic trust chain. No authoritative issuer-signed receipt corpus was evidenced in this audit. Therefore F&O settlement cash/margin movement must remain blocked.

## 6. Migration and persistence dependencies

The accounting components are not a single safe migration stack:
- Equity ledger #100 depends on #92 and remains Draft; its own description lists missing partial-fill, reversal/refund, full reconciliation and T+1 work.
- Options #122/#129 and Futures #135 have their own migration and accounting dependencies.
- Wallet initialization #131 and unified portfolio read model #158 are separate Draft branches.
- Migration coordination plan #116 exists specifically because migration timestamps/dependency chains diverge.
- PR #245's recorded hosted audit states 15 hosted migration versions versus 44 repository migration files at that audit point (29 not applied); this audit performed no hosted migration and does not infer that count as a safe pending migration plan.

Do not concatenate or apply these draft migration chains without a fresh exact-SHA dependency graph and disposable database proof. Applied migration history is immutable.

## 7. Required accounting equations for a future independent report

All values must be integer paise and computed from a single consistent account snapshot plus complete, authoritative source-event history.

- `available_cash = cash_balance - reserved_cash - reserved_margin` (with any separately defined blocked categories represented explicitly; never double-count them).
- `cash_balance = verified_opening_cash + sum(verified_cash_deltas)`.
- `blocked_funds = sum(open_verified_reservations) - sum(verified_consumptions_and_releases)`.
- Per fill: `gross_paise = quantity * price_paise`, with safe-integer checks and receipt-to-fill identity.
- Position quantity and cost basis must be rebuilt from fills plus verified corporate/expiry/settlement/reversal events using asset-specific rules; no mark price may change cost basis.
- Realized P&L must reconcile to closed quantity basis plus verified proceeds/payouts less all applicable verified charges.
- Unrealized P&L is separately valued from fresh, correctly scoped marks; if any required mark is missing/stale, suppress the aggregate rather than substitute a value.
- Every source event, receipt, reversal, and idempotency key must be unique and correctly scoped; replay must reproduce the same projection byte-for-byte / canonical-hash-for-hash.

These equations are a test contract, not a claim that the current implementation satisfies them.

## 8. Explicit blockers — no attestation possible

1. No complete authoritative historical event export was supplied or independently read from the persisted Equity/Futures/Options ledgers.
2. No single transactionally consistent repeatable-read snapshot spanning account, all orders/fills, reservations, positions, charges, reversals and settlement receipts was evidenced.
3. Equity partial-fill production lifecycle and complete refund/reversal/T+1 lifecycle are not proven.
4. F&O production receipt trust (issuer registry, key resolution, cryptographic verification and authoritative source provenance) is absent.
5. Official Futures MTM/expiry settlement ingestion and authoritative source records are not proven.
6. Fees, taxes, charges and margin cannot be independently reconciled end-to-end across all three asset classes.
7. Duplicate replay, concurrent fill/cancel/reserve, transaction rollback and cross-asset isolation have not been independently demonstrated against the same disposable PostgreSQL schema and exact integrated code head.
8. Existing PRs are separate Draft branches; their migrations and code are not one integrated, verified persisted ledger.

## 9. Chat 66 continuation — independent Demo event audit reducer

A separate read-only Node module, `market-gateway/lib/paper-demo-ledger-reconciliation.js`, and deterministic tests were added on this continuation branch. It independently checks the schema-1.2.0 Demo event envelope (scope, ordering, unique event/idempotency/source keys, paise arithmetic, Equity gross cash direction, derivative no-cash boundary, order/fill linkage, fill quantity and position arithmetic) and emits a stable SHA-256 report. It is deliberately not wired to production reads or writes and never sets `ledgerReconciled=true`.

This is a **Demo-event consistency checker only**, not an authoritative persisted-ledger reconciliation. The event schema has no first-class fee, reversal, authoritative settlement receipt, dated settlement or market-mark events. The reducer therefore returns explicit blockers for those omitted source domains and for absent independently verified opening/history provenance. Its tests must not be interpreted as proof of PostgreSQL transaction, concurrency or production ledger behavior.

## 10. Disposable PostgreSQL coverage reviewed

The existing disposable PostgreSQL workflow on the current candidate includes transaction-scoped SQL tests ending in `ROLLBACK`, including Futures partial/full fill and replay assertions, Options partial/full fill and replay assertions, and concurrent Futures/Options fill-versus-cancel plus duplicate execution race scripts. It also runs the complete `market-gateway` Node test suite. This is useful per-engine regression coverage, but it is not an independently reconciled unified cross-asset event ledger; the tests use separate persisted engines and do not establish one atomic cross-asset account snapshot. The new independent Demo reducer tests are Node-only and do not claim PostgreSQL coverage. The exact continuation PR workflow results are recorded in Section 11 below. These workflow results do not expand the scope of what the SQL fixtures prove.

## 11. Exact-head CI evidence — 2026-11-26

The latest exact-head CI runs were fetched for continuation commit `dbb5f70349b88558b1ad31b35762157356758f0c`. Both relevant workflows completed successfully:

| Workflow | Run ID | Result | Scope |
|---|---:|---|---|
| S-TRADE Futures Options Demo UI Integration | `45856692646` | Completed — success | Full gateway regression: 679 tests, 642 passed, 0 failed, 37 skipped; separate Demo integration run: 16 passed, 0 failed, 0 skipped; syntax, production-isolation and Demo wiring checks passed |
| Paper Trading Supabase SQL smoke test | `45856692758` | Completed — success | Disposable PostgreSQL 16 job: 74 steps, 74 succeeded, 0 failed, 0 skipped; ordered draft migrations, per-engine accounting, partial-fill/replay, race, tenant-isolation and RPC-boundary checks completed |

The SQL workflow applied ordered draft migrations only to its disposable PostgreSQL 16 service. The disposable database/container was stopped and removed by the workflow. No hosted Supabase migration, production/staging write, deployment, or live-account mutation was performed.

The successful SQL run is meaningful engine-level integration evidence, but it does **not** demonstrate a single atomic cross-asset historical ledger snapshot, complete authoritative source history, production receipt trust, or hosted real-user balance reconciliation. The 37 skipped Node tests are reported explicitly and are not counted as passes. The separate 16-test Demo integration run is not additive to the 679-test full-suite total.

The PR description was also updated to record these exact-head results. These results apply only to commit `dbb5f70349b88558b1ad31b35762157356758f0c`; any subsequent commit requires fresh exact-head CI before its changes can be considered tested.

## 13. Latest exact-head CI — 2026-11-26

The latest checker hardening commit `9d49b0366a4dfc7c365cee186dca9aecd6956542` has completed both relevant GitHub Actions workflows successfully:

| Workflow | Run ID | Result | Scope |
|---|---:|---|---|
| S-TRADE Futures Options Demo UI Integration | `45857404864` | Completed — success | Full gateway regression: 682 tests, 645 passed, 0 failed, 37 skipped; separate Demo integration: 16 passed, 0 failed, 0 skipped |
| Paper Trading Supabase SQL smoke test | `45857404835` | Completed — success | Disposable PostgreSQL 16 job: 74 steps, 74 succeeded, 0 failed, 0 skipped; ordered draft migrations, accounting, partial-fill/replay, race, tenant-isolation and RPC-boundary checks |

The SQL workflow's final cleanup step completed successfully; its disposable PostgreSQL service was stopped and removed. The expected rejection messages in negative SQL tests are test fixtures, not workflow failures. The workflow performed no hosted Supabase migration, production/staging write, deployment, or live-account mutation.

This is the latest exact-head CI evidence for the checker code. It still does not establish a unified cross-asset persisted ledger or authoritative historical financial reconciliation. The independent checker continues to report `ledgerReconciled=false`.

## 12. Required next verification before any reconciliation flag change

- Obtain a read-only, complete, account-scoped export with source hashes and coverage boundaries for every authoritative table/event stream.
- Build an independent deterministic report that starts from verified opening evidence and enumerates every event; report missing/extra/conflicting IDs and per-invariant totals. Never fill gaps with a synthetic transaction.
- Build disposable PostgreSQL fixtures from the exact integrated migration chain and test concurrent operations, rollback, partial fills, cancellation, rejection, expiry, reversals and duplicate replay.
- Verify the same source data using an independent implementation, not the production projection helper itself.
- Require zero unexplained differences and complete source coverage for Equity, Futures and Options before considering any reconciliation attestation.

**Final audit decision: BLOCKED. `ledgerReconciled=false` must remain unchanged.** This report itself does not authorize any balance mutation, migration, deployment, activation, merge, or settlement posting.
