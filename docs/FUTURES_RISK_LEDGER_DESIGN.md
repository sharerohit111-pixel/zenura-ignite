# Futures Risk Ledger — Database Design Proposal

**Status:** Design only. No SQL migration, RPC, database write, deployment, or production activation is included.

**Scope:** NSE Futures paper-trading risk and accounting. This proposal is Futures-specific and must be reconciled with the ordered Futures LIMIT migration chain and the live Supabase migration history before implementation.

## 1. Goals and non-goals

Goals:
- Persist immutable, auditable Futures risk/accounting events.
- Make event posting idempotent under retries and concurrent workers.
- Preserve exact cash, position, and margin conservation in integer paise.
- Support daily simulated variation margin, explicit expiry settlement, and an explicitly simulated liquidation event.
- Preserve existing MARKET/LIMIT order lifecycle and lock ordering.

Non-goals:
- No real exchange, SPAN, broker, or Upstox margin calculation/claim.
- No live broker order routing or automatic real-world liquidation.
- No automatic contract carry or implicit expiry-price fallback.
- No replacement of existing order, fill, account, or worker lease tables.

## 2. Proposed Futures-only append-only event ledger

Proposed table name: `paper_futures_risk_events`.

Each row is one immutable accounting fact. Suggested columns:
- `id`: UUID primary key.
- `user_id`, `account_id`: tenant and paper account identity, with foreign keys to the repository's canonical account ownership records.
- `event_key`: caller/worker idempotency key, unique within the account and event namespace.
- `event_type`: constrained enum/text value.
- `payload_hash`: SHA-256 of canonical immutable request payload.
- `order_id`, `position_id`, `contract_key`: nullable references/context, with exact contract identity and expiry captured on the event.
- `signed_quantity`: signed integer quantity relevant to the event; zero only for account-level adjustments that explicitly permit it.
- `price_paise`, `prior_settlement_price_paise`, `settlement_price_paise`: nullable positive integer price fields according to event type.
- `cash_delta_paise`, `margin_delta_paise`, `realized_pnl_delta_paise`: signed integer deltas; no floating-point money.
- `margin_model`, `model_version`: explicit simulation model/version; never label configurable scenario margin as exchange margin.
- `source_type`, `source_reference`, `source_timestamp`: required provenance for quote/settlement-driven events.
- `simulation_only`: NOT NULL and constrained TRUE.
- `created_at`: server timestamp.

Candidate event types:
- `MARGIN_RESERVED`, `MARGIN_RELEASED`, `MARGIN_ADJUSTED`
- `DAILY_VARIATION_POSTED`
- `EXPIRY_SETTLEMENT_POSTED`
- `SIMULATED_LIQUIDATION_POSTED`
- `ROLLOVER_CLOSE_POSTED`, `ROLLOVER_OPEN_POSTED`

Do not put mutable "current balance" fields in the event table. Current state remains in canonical account/position rows and is changed atomically with event insertion.

## 3. Supporting settlement state

A separate Futures-specific settlement-basis table (or a rigorously versioned position extension after coordination) is needed to retain:
- account/user and exact contract/expiry identity;
- position identity and current signed open quantity;
- last accepted settlement price in paise;
- settlement session/date and source/provenance;
- monotonically increasing settlement version;
- last applied event identity.

A unique key must prevent more than one accepted settlement basis for the same account, contract, position, and settlement session. The basis must advance only in the same transaction that posts its variation event. Never infer prior settlement from average entry price after the first settlement.

## 4. Idempotency and immutable payload rules

1. Require a non-empty event key and canonical payload hash.
2. Unique constraint: account + event namespace + event key.
3. On replay, load the existing event. If the payload hash matches, return the original receipt without another accounting effect.
4. If the same key is reused with a different hash, reject with an idempotency conflict; never overwrite the event.
5. Event rows are append-only. Revoke UPDATE/DELETE from application roles. Corrections use a new compensating event referencing the original event.
6. Unique settlement identity prevents duplicate daily variation or duplicate expiry posting even if worker leases expire and another worker retries.

## 5. Atomic RPC contracts

All write operations must be server-side SECURITY DEFINER RPCs with a fixed empty search_path, explicit argument validation, and EXECUTE grants limited to the trusted service role (plus migration owner as required). No direct authenticated table mutation.

Required transaction order:
1. Lock canonical account row.
2. Resolve/lock idempotency event identity and validate payload hash.
3. Lock the exact Futures position and settlement-basis row in a documented deterministic order.
4. Validate account ownership, contract key, expiry, signed quantity, source provenance, and state transition.
5. Insert immutable event.
6. Update cash, reserved margin, position quantity/basis/margin, settlement basis, and account version as applicable.
7. Assert conservation invariants and commit.

The lock order must remain account → event/idempotency identity → position, consistent with the existing Futures transaction chain. Do not change common account locking or generic worker lease primitives in this workstream.

RPC contracts (names are illustrative; final names must follow repository conventions):
- `post_paper_futures_margin_event`: reserve/release/adjust simulated margin with an owned source reservation.
- `post_paper_futures_daily_variation`: one settlement session, explicit settlement price/provenance, exact signed open quantity, and prior-basis version.
- `post_paper_futures_expiry_settlement`: require expiry reached and explicit official/provider-supplied settlement source; close exact signed quantity and release residual position margin.
- `post_paper_futures_simulated_liquidation`: paper-only policy event, separately authorized, no broker routing.
- Rollover remains two separate idempotent legs: close old contract and open the new contract. Never silently mutate the contract key of an existing position.

## 6. Accounting equations and conservation

All money values are integer paise; use checked arithmetic and reject unsafe/out-of-range values.

- Account reserved margin = sum(open Futures position margin) + sum(pending Futures opening-order reservations).
- Position margin = initial allocation + additions − releases; it must never be negative.
- Available virtual cash/margin must respect the existing account constraint: reserved cash + reserved margin cannot exceed cash where that is the canonical account contract.
- Daily variation = signed open quantity × (today settlement price − previous settlement price).
- After successful daily posting, the settlement basis advances exactly once to today's settlement.
- Expiry settlement realizes signed quantity × (explicit expiry settlement price − current settlement basis), releases all residual position margin, and leaves zero open quantity for that expired contract.
- A simulated liquidation event must reconcile the exact closed quantity, realized P&L, charges (if applicable), and released margin.

Never count the same pending opening margin both as an order reservation and as position margin after fill. Partial fill transfers reservation to position atomically.

## 7. RLS, grants, and operational security

- Enable RLS explicitly on every new public table.
- Authenticated users receive only SELECT-own access if product UI needs event history; no direct INSERT/UPDATE/DELETE.
- Service role receives only the minimum required privileges; mutating RPCs remain service-role-only.
- Revoke broad PUBLIC/anon/authenticated function execution by default.
- Explicitly set `simulation_only = TRUE` with a database CHECK constraint.
- Avoid exposing internal payload hashes, provider secrets, or worker metadata in user-facing APIs.
- Add audit-safe retention/backup expectations before implementation; do not delete ledger history to "fix" balances.

## 8. Required test matrix before any migration is considered

- Duplicate same-key/same-payload replay produces one event and one accounting effect.
- Same key/different payload is rejected with no mutation.
- Two concurrent daily settlement attempts for the same position/session result in one posting.
- Stale settlement-basis version is rejected.
- Long and short variation debit/credit signs are correct.
- Partial position quantity changes are handled against the exact settlement quantity snapshot; concurrent fills cannot be silently omitted.
- Expiry before cutoff is rejected; missing settlement provenance is rejected; duplicate expiry is idempotent.
- Expiry closes exact signed quantity and releases exact residual margin.
- Margin over-release, negative margin, unsafe integer arithmetic, and insufficient cash are rejected atomically.
- Rollover close/open legs are independently idempotent and cannot change the old contract in place.
- Simulated liquidation is marked paper-only and cannot call broker/provider order APIs.
- RLS, grants, tenant isolation, and SECURITY DEFINER search_path are tested.
- Account and position conservation are asserted after every success and rollback path.

## 9. Migration sequencing and release gates

1. Reconcile the open Futures LIMIT PR chain with the actual hosted Supabase migration history. An open PR is not evidence of deployment.
2. Confirm the exact base branch, latest head SHA, repository-pinned Supabase CLI version, and migration ordering.
3. Implement Futures-only DDL and RPCs in a separate Draft PR; do not modify shared account schema, Equity/Options, Upstox integration, or generic worker leases here.
4. Run the full disposable PostgreSQL/Supabase-compatible CI suite, including concurrency and RLS/grant tests.
5. Review generated SQL and lock order manually; verify no broad grants or authenticated mutation path.
6. Only after dependency PRs are reviewed/merged and a separately authorized release plan exists may a hosted migration be considered. This proposal itself performs no deployment.

## 10. Explicit safety labels

All configurable margin, maintenance checks, variation posting, expiry accounting, rollover, and liquidation simulations must be labelled paper/simulation-only. A configurable rate is not NSE/SPAN/official margin. A maintenance breach is not an exchange liquidation notice. No action in this design is permitted to submit a real broker order.
