# ZENURA IGNITE S-TRADE — Chat 33 Wallet Accounting Closure Audit

Audit date: 2026-11-25  
Scope: PR #188, #192, #193, #199  
Audit branch: `fix/wallet-accounting-closure-2026-11-25`  
Audit baseline: PR #192 head `08c2c17272b41e8a7bdcca8ec1bc05d09ab19d2f`

## Decision

**NOT CLOSED — do not merge or deploy.** Keep `ledgerReconciled=false`. No production migration, live broker execution, or Crypto changes. No estimated brokerage, taxes, exchange charges, fees, premium, or margin.

## Exact findings

### P0 — Equity fill cash movement is not receipt-gated

At the audit baseline, `markets/shared/paper-demo-event-ledger.mjs` validates an Equity fill's order linkage, fill identity, quantity, and integer price. The generic `append()` path rejects direct `SETTLEMENT_RECEIPT_ACCEPTED` events, but still permits a `FILL_RECORDED` event to carry a non-zero `cashDeltaPaise`. The PR #188/#193 invariant compares Equity cash delta with `quantity * pricePaise` and BUY/SELL direction, but arithmetic correctness does not prove the fill or cash settlement is authoritative.

**Required closure:** no Equity wallet cash debit/credit until a trusted, account/session/order/fill-bound authoritative receipt is cryptographically verified and consumed exactly once. Gross must be exact integer paise. BUY/SELL direction must match the verified receipt. Without that receipt, reject the cash movement; do not estimate or synthesize it.

### P0 — Blocked-fund movement is not fully receipt-bound

The event ledger applies `blockedDeltaPaise` before event-specific state transitions. The PR #193 guards prohibit some invalid signs and non-order mutations, but they do not prove the amount or ownership of every reservation/release. In particular, generic order updates and rejection/fill transitions can carry negative blocked deltas that are not independently tied to an authoritative reservation receipt. A positive order-acceptance block is also not enough by itself to establish an approved reservation amount.

**Required closure:** every wallet blocked-fund reserve/release must be backed by a verified receipt bound to account, session, order, action and exact amount. A fill, cancel, reject, expire, or update must release only the exact remaining reservation attributable to that order; replay and duplicate release must be rejected. Equity SELL share reservations are a separate share-quantity reservation and must not be confused with wallet cash blocks.

### P0 — Current F&O verifier is an injected contract, not production trust

`markets/shared/paper-demo-settlement-receipt.mjs` requires a trusted issuer allowlist and a `verifyAttestation` callback. The test suite supplies a verifier that compares a signature string with a hard-coded test string. This demonstrates the callback contract and fail-closed behavior when no verifier is supplied; it does not establish a production cryptographic verifier, issuer registry, key lifecycle, or authoritative clearing-source trust.

**Required closure:** wire only an independently managed trusted issuer/key registry and a real cryptographic verifier. Keep test fixtures explicitly test-only. Do not describe callback acceptance as production cryptographic verification.

### P1 — Wallet projection does not independently reconcile the ledger

PR #199's `projectPaperDemoWallet` validates snapshot arithmetic, sequence, account/session identity, order/fill relationships, and position shape. Those checks do not independently replay the canonical event stream and prove that the snapshot cash and blocked balances are the result of verified events. A self-consistent snapshot can still be unsupported by authoritative event evidence.

**Required closure:** replay the complete immutable stream from the defined opening snapshot using the same trust configuration, compare all derived account/order/fill/position fields with the supplied snapshot, and fail closed on any mismatch. This remains a consistency check, not external clearing reconciliation; `ledgerReconciled` must remain false until the independent authoritative reconciliation process exists.

## PR topology and CI evidence

- PR #188 is Draft and targets base SHA `491b9f6ee808f12a0dddd7f670f35bad0f0cae05`.
- PR #193 is Draft and targets the same base SHA `491b9f6ee808f12a0dddd7f670f35bad0f0cae05`.
- PR #192 is Draft, head `08c2c17272b41e8a7bdcca8ec1bc05d09ab19d2f`, and is based on PR #187 head `7e9d6f3b3b1aeae4110e4047519c2895570e9361`.
- PR #199 is Draft and targets a different base SHA `3115b36a93619fd37da6dcd819791e589cb500c1`.

These are divergent review lines, not one proven integrated accounting head. Do not blind-merge or rebase them. Previously observed individual PR-head CI runs were green, but they do not prove a combined exact-head integration build.

## Required closure sequence

1. Define and implement a real authoritative receipt trust boundary; no caller-supplied permissive verifier in production.
2. Gate every wallet cash and blocked-fund delta through a verified, scope-bound, replay-protected receipt path.
3. Bind Equity fills to receipt gross, side, quantity, price, order, fill, account and session; never infer fees or charges.
4. Bind BUY reservation and every partial-fill/cancel/reject/expire release to exact remaining receipt-backed amounts.
5. Replay canonical events and compare the entire derived wallet projection.
6. Add negative tests for missing/forged/untrusted/wrong-account/wrong-session/wrong-order/wrong-fill/wrong-side/wrong-amount/duplicate/stale receipts, duplicate releases, and terminal-order reopening.
7. Run all tests and CI against one exact candidate head; report the SHA and run IDs. Do not claim PASS from separate PR heads.

## Current controls

- `ledgerReconciled=false` remains mandatory.
- No authoritative receipt means no wallet cash movement.
- No verified reservation receipt means no wallet blocked-fund movement.
- No estimated fees, charges, taxes, brokerage, or margin.
- No merge, deployment, production migration, or live trading action was performed.
