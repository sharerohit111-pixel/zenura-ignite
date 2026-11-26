# S-TRADE Chat 73 — Financial Ledger & Settlement Closure

**Audit date:** 2026-11-26  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Scope:** Indian Market Paper Trading only. Retired Paper Investing is excluded.  
**Decision:** **BLOCKED — `ledgerReconciled=false` must remain.**  
**Mode:** Read-only evidence collection; no production/staging writes, migrations, deployments, repairs, balance changes, merges or broker activity.

## 1. Exact source references

| Source | SHA / evidence |
|---|---|
| `main` at PR #245 base | `dbb7eeaf8ef2fe5a2a77040e8c95b5f8c16c08c9` |
| Current PR #245 candidate HEAD | `e2474bc301ac9f71f89cb8c36187d89547c00849` |
| Prior independent checker PR #252 HEAD | `dffe93772c95079a7c726332c05237c1abcaef98` |
| PR #252 base / merge base with current candidate | `2e400f67cc1f5548441c8fa499584a9913d43fd3` |
| PR #252 comparison to current PR #245 | 15 commits ahead, 3 behind; `diverged` |
| Chat 73 audit branch | `audit/chat73-financial-ledger-closure-2026-11-26`, created from exact PR #245 HEAD above |

PR #252 is not integrated into the latest PR #245 candidate. Its CI is valid for its own head only; it is not evidence for the combined current candidate.

## 2. Authoritative persisted state versus Demo events

The hosted Paper Trading persistence is a set of Supabase/PostgreSQL account, order, position and reservation tables. It is not a single append-only cross-asset accounting journal.

The browser module `markets/shared/paper-demo-event-ledger.mjs` (schema 1.2.0) is a synthetic Demo event stream with sequence/time/idempotency checks and derived projections. It is not the authenticated persisted ledger and must not be promoted into a second competing accounting architecture.

The PR #252 independent reducer, `market-gateway/lib/paper-demo-ledger-reconciliation.js`, intentionally checks only that synthetic Demo envelope. It independently validates safe integer-paise deltas, event IDs/idempotency/source IDs, sequence and monotonic timestamps, Equity gross cash direction, order/fill linkage, position arithmetic and the no-derivative-wallet-cash boundary. It always returns `ledgerReconciled=false`; its tests are not proof of persisted-ledger reconciliation.

## 3. Hosted read-only evidence

Project: `zenura-paper-trading` (`atvbjibhunvzpmfagagm`), region `ap-south-1`, status `ACTIVE_HEALTHY`, PostgreSQL 17.12.

A subsequent read-only inventory across all non-system schemas (not only `public`) found no additional application-owned ledger, event, fill, settlement, refund, reversal or receipt table in another schema. The other listed schemas are Supabase-managed `auth`, `storage`, `realtime`, `vault` and `supabase_migrations`; their internal migration/identity/storage metadata is not a Paper Trading transaction journal. This broadens the schema-name inventory only; it does not establish lifetime history completeness or authorize reading auth/user contents.\n\nThe hosted migration history contains **15 applied versions**. The inspected PR #245 candidate contains **44 migration files**; therefore **29 candidate migration versions are absent from the hosted migration history** at this audit. This is a schema/code divergence measurement, not an instruction to apply those migrations. No migration was applied.

Exact read-only `COUNT(*)` results for the eight existing core Paper Trading accounting tables:

| Hosted table | Exact rows |
|---|---:|
| `paper_accounts` | 0 |
| `paper_equity_positions` | 0 |
| `paper_derivative_positions` | 0 |
| `paper_orders` | 0 |
| `paper_derivative_orders` | 0 |
| `paper_futures_orders` | 0 |
| `paper_futures_positions` | 0 |
| `paper_protective_orders` | 0 |
| **Total observed across these tables** | **0** |

All eight inspected tables had RLS enabled. No row contents, user identifiers or account balances were retrieved.

The following queried relations were absent from the hosted schema at audit time: `paper_futures_fills`, `paper_option_limit_orders`, `paper_option_limit_fills`, `paper_settlement_receipts`, `paper_futures_settlements`, `paper_option_settlements`, `paper_ledger_events`, `paper_account_events`, `paper_equity_fills`, `paper_reversals`, and `paper_refunds`. Some are defined by later candidate migrations; absence is not permission to deploy them.

**Quantification:** 0 rows were observed in the eight existing core Paper Trading tables. The total historical/unreconciled event count is **NOT COMPUTABLE**: required later tables are absent, there is no complete authoritative event export, and there is no verified opening-to-current source history. Do not interpret the zero row count as proof of lifetime completeness or as proof that no external/historical records exist.

Retired `paper_investing_*` tables, if present, are explicitly outside this audit and are not used, queried for balances, or revived.

## 4. Persisted source map and lifecycle coverage

| Domain | Persisted source / candidate migration evidence | Audit conclusion |
|---|---|---|
| Opening balance | `paper_accounts.starting_cash_paise`, `cash_paise`; `20261122120710_paper_account_initialization.sql` initializes INR virtual cash idempotently | Hosted account count is zero; no account-specific opening provenance exists to reconcile |
| Equity orders/fills | `paper_orders`, `paper_equity_positions`; `20261122120703_paper_order_transactions.sql`, LIMIT and equity fee-aware migrations | Order rows can carry execution/gross fields; no independent immutable equity fill/event journal was evidenced |
| Futures orders/fills | `paper_futures_orders`, `paper_futures_positions`; `20261122120722_futures_market_order_transaction.sql`, `20261123140000_futures_limit_ledger_foundation.sql`, later submit/fill migrations | Hosted base order/position tables are empty; candidate fill table/migrations are not hosted |
| Options orders/fills | `paper_derivative_orders`, `paper_derivative_positions`; `20261122120713_paper_long_option_transaction.sql`, later Options LIMIT schema/submit/fill migrations | Hosted base tables are empty; candidate Options LIMIT order/fill tables are not hosted |
| Fees and taxes | Equity fee/charge migrations, `trading-charges.js`, Options `charges_paise` and `charges_breakdown`, Futures fill charge fields | Per-engine calculations and disposable tests exist; no complete persisted lifetime charge export exists |
| Blocked funds | `paper_accounts.reserved_cash_paise`, `reserved_margin_paise`; per-order and position reservation fields | SQL guards and per-engine tests exist; no single cross-asset historical reservation journal/snapshot is proven |
| Realized P&L / cost basis | Account/order/position fields; engine-specific SQL transaction functions | Current-state fields exist; full reconstruction from complete fills, charges, reversals and settlements is not proven |
| Unrealized P&L | Valuation/read-model code and market marks | No independently verified, complete and fresh mark set was supplied; do not certify aggregate unrealized P&L |
| Reversals/refunds | No complete hosted Paper Trading reversal/refund source tables found in the queried names | Historical reversal/refund completeness is not established |
| Settlement receipts | No hosted receipt/settlement relation among queried names; earlier receipt designs use an injected verifier seam | No authoritative receipt corpus, trusted issuer/key registry or production cryptographic verification was evidenced |

**Derivative cash-movement finding:** the candidate `execute_paper_long_option_order` SQL computes a virtual cash delta from option premium and charges, while `execute_paper_futures_market_order` updates virtual cash from realized P&L less charges and updates margin reservations. These are simulation transaction calculations, not independently evidenced, signed internal simulation receipts. Under the confirmed Hybrid decision, a correctly committed Paper Trading transaction may be the source of truth for virtual cash/margin accounting, while an internal signed receipt is post-commit audit evidence; it is not an external settlement prerequisite or balance-posting authority. The current hosted functions have no demonstrated receipt issuance/verification linkage, so the internal receipt-attestation gate remains open. No external exchange/clearing settlement may be claimed from these simulated calculations.

A separate read-only hosted catalog/function-definition query confirmed both `public.execute_paper_long_option_order` and `public.execute_paper_futures_market_order` exist. Both function definitions reference account cash and charges; the queried definitions contain no receipt reference. This confirms the absence of receipt issuance/verification linkage in the currently hosted function definitions, not merely in candidate source files. No function was invoked and no data was changed.

**Prior receipt-contract draft chain — not integrated into PR #245 or hosted:** A targeted review of the earlier receipt work found these still-open Draft PRs, each on a separate branch/base:

| PR | Exact head | State / contribution | Remaining trust gap |
|---|---|---|---|
| [#187](https://github.com/sharerohit111-pixel/zenura-ignite/pull/187) | `7e9d6f3b3b1aeae4110e4047519c2895570e9361` | Receipt validation contract; scope, issuer allowlist, replay IDs and amount direction | Verifier is injected; no production issuer registry, key resolution or cryptographic verifier |
| [#192](https://github.com/sharerohit111-pixel/zenura-ignite/pull/192) | `08c2c17272b41e8a7bdcca8ec1bc05d09ab19d2f` | Closes generic settlement-event append bypass | Still depends on #187's untrusted verifier seam |
| [#196](https://github.com/sharerohit111-pixel/zenura-ignite/pull/196) | `f8b307e3c272e6f709333ac0eb3f2fd902033a8c` | Binds Options receipts to canonical order/fill and bounds Futures reservation release | No actual trusted issuer/key trust chain or authoritative receipt corpus |
| [#213](https://github.com/sharerohit111-pixel/zenura-ignite/pull/213) | `c4d58c331951850c36219ef8309609213cc916a8` | Fail-closed generic wallet changes unless receipt path accepted | Demo event-ledger only; verifier seam remains test-only, no production trust |

All four PRs were confirmed open, Draft and unmerged at inspection; their branches are not part of the current PR #245 candidate or PR #267. The validator in #187 accepts a caller-provided `verifyAttestation` callback and caller-provided `trustedIssuerIds`; the positive test uses a test callback that compares a literal test signature string. That proves the contract's fail-closed wiring, not cryptographic signature authenticity. Do not copy this test callback or a hard-coded allowlist into production, and do not merge these stacked drafts independently or assume their combined ancestry is hosted. The safe next dependency is a separately reviewed production trust design (issuer identity, key lifecycle/rotation/revocation, canonical signed payload, algorithm policy, replay store, source provenance and operational ownership) before any receipt can be trusted as audit evidence for persisted cash/margin movements.

## 5. Arithmetic, replay and ordering

- Persisted money columns and transaction inputs use integer paise (`bigint`); relevant SQL functions include safe-range checks and integer gross calculations.
- Account-first row locks, unique idempotency indexes, request fingerprints and duplicate-retry checks exist in the candidate transaction RPCs.
- Candidate disposable PostgreSQL workflows exercise per-engine accounting, partial fills, replay, fill/cancel races, duplicate execution and rollback.
- Demo schema 1.2.0 enforces safe-integer deltas, event sequence and strictly increasing timestamps, unique event/idempotency/source identifiers, and deterministic replay/hash output. The independent checker rejects non-zero blocked-funds deltas because this schema has no attributable reservation source/order binding.
- Persisted SQL rows have timestamps and per-account versioning, but the inspected persisted architecture does not provide one global event sequence covering all Equity/Futures/Options events.
- A passing per-engine test suite does not prove a single atomic cross-asset historical snapshot or complete source provenance.

## 6. Asset-specific gates

**Equity:** Gross notional, cash direction, fee-aware transaction paths, reservations and cost-basis checks exist in candidate SQL/tests. Hosted core rows are zero. Complete lifetime fill/charge/reversal/T+1 settlement provenance is not established.

**Futures:** Candidate Futures SQL supports margin reservations, realized P&L and fill lifecycle tests. Its MARKET transaction function currently derives virtual cash from simulated realized P&L and charges and updates margin. No hosted Futures fill table or internal signed simulation receipt source was found. The simulated cash/margin calculation is not independently receipt-attested. The Hybrid decision permits internal virtual accounting only through the authenticated atomic Paper Trading transaction path, with a signed receipt as post-commit audit evidence once implemented; it does not represent external clearing settlement.

**Options:** Candidate long-option transactions include charge breakdown and derive virtual cash deltas from simulated premium and charges; later LIMIT migrations define fill and reservation lifecycle. Those later relations are absent from hosted schema. No internal signed simulation receipt store or verifier was evidenced for the simulated cash movements. The Hybrid decision permits an internal receipt to attest to an already committed virtual transaction once implemented; it does not attest to external option exercise, expiry or clearing settlement.

For both derivative classes, virtual cash/margin movements must come only from the existing authenticated, atomic Paper Trading transaction path using persisted order/fill facts, integer-paise arithmetic and idempotency—not from browser events or inferred fills. Once implemented, the internal signed simulation receipt attests to the committed transaction and is checked during reconciliation; it does not itself post or repair balances. External settlement claims require separately authenticated evidence from the relevant authorized external source.

## 7. Exact-head CI evidence reviewed

**PR #252 exact HEAD** `dffe93772c95079a7c726332c05237c1abcaef98`:
- Demo UI Integration run `45857744221`: completed successfully; all job steps, including full gateway regression and Demo wiring, succeeded.
- Paper Trading Supabase SQL smoke run `45857744246`: completed successfully; disposable PostgreSQL job's ordered migration, per-engine accounting, replay/race and cleanup steps succeeded.
- This evidence applies to PR #252 HEAD only, not to its combination with the newer PR #245 HEAD.

**Current PR #245 exact HEAD** `e2474bc301ac9f71f89cb8c36187d89547c00849`:
- Exact-head workflow runs observed: Demo UI Integration `45856158949`; Demo Screen Wiring `45856158954`; Authenticated Browser Security `45856159081`; Firebase read-only export tests `45856159055`; Indian Market Code `45856158936`; Paper Trading Supabase SQL smoke `45856159104`; Mega Kirana backend validation `45856159061`.
- All seven reported completed successfully. The SQL workflow completed 70 numbered test steps and disposable-container cleanup.
- These checks validate that candidate SHA, not the missing hosted migration history or real account reconciliation.

**Chat 73 audit branch code/test parent:** `679783253501af86c847ed9e017ce80e5ffe78f1` received Demo UI Integration run `45861617919` and Paper Trading Supabase SQL smoke run `45861617899`; both completed successfully, with all 70 SQL steps and disposable-container cleanup.

**Receipt verifier + KMS adapter current exact code/test HEAD:** `6d4529319349fa7b0ee7969f52eb61815ec8225b` received Demo UI Integration run `45864091311`, completed successfully. The full gateway regression reported 705 tests, 668 passed, 0 failed, 37 skipped; the separate Demo screen integration reported 16 passed, 0 failed, 0 skipped. Gateway/browser syntax, production isolation and interactive Demo wiring passed. Dedicated receipt tests passed, including standard CRC32C vector, mock-KMS Ed25519 signing, malformed-payload rejection before KMS invocation, signature verification, altered-payload rejection, committed-amount/version binding, key scope/validity/revocation and private-key-material rejection.

Paper Trading Supabase SQL smoke run `45864091188` was still in progress at this report update, at the production gateway image-build step. It is not counted as passed. Earlier attempts were cancelled during that same image-build stage; all later database/migration steps were skipped. No database migration or hosted write was performed by this receipt work. The receipt signer/verifier are isolated Node.js modules and do not change SQL/accounting paths. These CI results validate repository tests only; they do not prove hosted historical ledger completeness, production KMS provisioning, actual KMS signing, or persisted account reconciliation.

## 8. Product decision — hybrid simulation receipts (user-confirmed 2026-11-26)

The product owner selected **Hybrid (C)** for Paper Trading:

- An internal, digitally signed **simulation receipt** may support virtual Paper Trading accounting only after a production-grade signing and verification trust boundary is designed, reviewed and implemented.
- Such a receipt records an app-generated simulation event. It is not an exchange execution report, clearing-corporation receipt, bank movement, or real-world settlement confirmation.
- Any external-settlement claim requires independently authenticated evidence from the relevant authorized exchange/clearing source. Do not infer external settlement from an internal simulation receipt.
- Receipt verification, issuer/key lookup, signature validation, canonical payload validation, order/fill binding, amount/currency/direction checks, expiry/revocation policy and replay prevention must all succeed before a receipt is accepted for its explicitly permitted purpose.
- Missing, invalid, revoked, expired, duplicated, mismatched or unverifiable receipts must fail closed. No inferred derivative cash, margin, blocked-funds or settlement movement is permitted.
- The current injected `verifyAttestation` test seam in prior Draft PR #187 is not production cryptographic verification. No production issuer, key registry, signer, verifier, key lifecycle or operational owner has yet been evidenced. Do not treat this decision as implementation or authorization to post balances.
- The independent Demo reducer remains a read-only synthetic-schema checker and must continue returning `ledgerReconciled=false`.

This decision clarifies product semantics; it does not close the persisted-ledger, provenance, hosted migration, receipt-trust or reconciliation blockers.

The proposed internal receipt trust boundary is documented separately in [`S_TRADE_INTERNAL_SIMULATION_RECEIPT_TRUST_DESIGN.md`](./S_TRADE_INTERNAL_SIMULATION_RECEIPT_TRUST_DESIGN.md). The audit branch now contains an isolated Ed25519 verifier (`market-gateway/lib/paper-trading-simulation-receipt-verifier.js`) and a Google Cloud KMS signer adapter (`market-gateway/lib/paper-trading-simulation-receipt-kms-signer.js`), each with generated-key/mock-KMS tests. The verifier checks signatures, key scope/lifecycle and exact committed transaction bindings/amounts. The signer adapter sends canonical raw payload bytes to the KMS API with CRC32C request/response integrity checks and refuses malformed payloads before signing. Neither module is wired to accounting RPCs or a real Google Cloud project; no production KMS key, issuer/key registry, durable replay store, receipt table, migration or hosted transaction-path change exists. The canonical serializer still requires independent RFC 8785 conformance review.

## 9. Required closure evidence

1. A complete, account-scoped, read-only source export from the authoritative persisted store, with snapshot time, table coverage, source hashes and pagination/consistency proof.
2. Verified opening-balance provenance and complete order/fill/charge/reservation/reversal/refund/settlement history for each asset class.
3. A transactionally consistent snapshot spanning the shared account and every relevant asset table.
4. A deterministic independent reconciliation with per-table counts, missing/extra/duplicate/conflicting IDs, integer-paise totals and asset-specific conservation equations.
5. Production-grade internal simulation receipt issuer/key verification and exact order/fill binding as post-commit audit evidence for derivative virtual cash/margin movements; separately authenticated external receipts only for any external-settlement claim.
6. Zero unexplained differences and complete source coverage before any reconciliation attestation.

**Final decision: BLOCKED. Keep `ledgerReconciled=false`.** No balance repair, production migration, deployment, activation, merge, settlement posting or historical data synthesis is authorized by this report.
