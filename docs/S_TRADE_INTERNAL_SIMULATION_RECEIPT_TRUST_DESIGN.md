# S-TRADE — Internal Simulation Receipt Trust Design

**Status:** Proposed design only — not implemented, not production-approved  
**Product decision:** Hybrid (C), confirmed by product owner on 2026-11-26  
**Scope:** Indian Market Paper Trading only. Retired Paper Investing remains excluded.

## 1. Purpose and terminology

An **internal simulation receipt** is an application-issued, digitally signed audit artifact describing a Paper Trading transaction that the application has already accepted and persisted. It is evidence of what the Paper Trading system recorded; it is not an NSE/BSE execution report, clearing-corporation statement, bank transaction, broker contract note, or real-world settlement confirmation.

An **external settlement receipt** is evidence issued by an authorized external exchange/clearing source and independently authenticated under a separately approved integration. An internal simulation receipt must never be relabelled or promoted to an external settlement receipt.

## 2. Source-of-truth boundary

1. The existing authenticated Paper Trading database transaction path remains the source of truth for virtual orders, fills, charges, reservations, positions and virtual cash.
2. Do not create a second ledger, shadow balance store, parallel event-sourcing architecture, or a client-controlled accounting path.
3. A receipt attests to an already committed, uniquely identified transaction. It does not independently authorize a cash, margin, position, reservation, reversal, refund or settlement posting.
4. The database transaction must atomically enforce its own invariants and idempotency. Receipt issuance is downstream evidence, not a substitute for transaction correctness.
5. If a later architecture requires a signed pre-commit authorization, that is a separate security review and must not be inferred from this specification.

## 3. Trust boundary

- Receipt creation must occur only in a trusted server-side component after it has read the committed transaction from the authoritative database.
- The browser, mobile/PWA client, user-supplied payload, market-data adapter and ordinary application API caller must never choose a signing key or sign a receipt.
- Use an approved asymmetric signing algorithm and a managed KMS/HSM key. Ed25519 is a candidate only if supported and approved by the selected KMS and runtime; do not silently downgrade algorithms.
- Private key material must remain non-exportable in KMS/HSM. No private key, signing secret, service-role key or credential may be committed to source control, browser bundles, logs or test fixtures.
- A server-side verifier must resolve `issuerId` and `keyId` through a controlled registry, enforce algorithm/key binding, key validity windows, rotation and revocation, and verify the signature over the exact canonical payload bytes.
- Key ownership, access policy, audit logging, emergency revocation, backup/recovery and rotation responsibility must be assigned before production approval. No issuer, key, KMS or operator is assumed to exist today.

## 4. Receipt envelope

The versioned envelope should contain, at minimum:

- `receiptType = "PAPER_TRADING_SIMULATION"` and explicit `environment` (never a generic or exchange-settlement type)
- `schemaVersion`, `issuerId`, `keyId`, `algorithm`
- globally unique `receiptId`, `idempotencyKey`, and unique source transaction/event identifier
- account-scoped opaque identifier (no unnecessary personal data)
- asset class (`EQUITY`, `FUTURES`, `OPTIONS`), instrument/contract identity, side, product and order/fill identifiers
- integer-paise amounts and currency `INR`; quantity and price in explicitly defined integer units
- separately itemized gross amount, fees/taxes/charges, realized P&L and reservation effects where applicable
- committed transaction version/sequence, database commit timestamp, receipt creation timestamp and payload hash
- an explicit statement that this is simulated Paper Trading activity and not external execution/settlement

Use a deterministic canonical serialization (for example RFC 8785 JSON Canonicalization Scheme after schema validation). Sign the canonical bytes, not an ambiguously reserialized object. Reject unknown critical fields, invalid units, floating-point monetary values, unsafe integers, unsupported schema versions and ambiguous timestamps.

## 5. Issuance and verification lifecycle

1. The existing transaction RPC validates the authenticated owner, order/fill linkage, market/session rules, integer-paise arithmetic, fees, reservation and idempotency constraints.
2. The RPC atomically commits the virtual transaction and its existing authoritative identifiers/version. Do not add a new accounting ledger as part of receipt work.
3. A durable outbox/reference attached to that same committed transaction may request receipt issuance. Retries must be idempotent and must not repeat the accounting transaction.
4. A trusted server worker loads the committed facts from the database; it must not trust client-supplied amounts or positions.
5. The signer constructs the canonical envelope and signs it using the configured managed key.
6. The verifier independently validates schema, canonical bytes, issuer/key/algorithm binding, signature, key validity/revocation, timestamps, transaction/account/order/fill binding, currency/units, amount direction, and duplicate/replay state.
7. Persist the receipt and verification result against the existing transaction identifiers. A unique constraint must prevent duplicate receipt IDs and duplicate receipt-to-source bindings.
8. Reconciliation compares the signed receipt with the authoritative committed database transaction. Any mismatch is a blocker; never repair balances from the receipt.

A receipt issuance outage may leave an existing transaction without its audit receipt. Such a transaction must be visibly marked as receipt-pending/unverified for reconciliation and must not be described as receipt-verified. It must not cause an automatic second posting or a fabricated receipt.

## 6. Replay, ordering and lifecycle safety

- Enforce uniqueness for `receiptId`, source transaction/event ID, and idempotency key within the documented issuer/account scope.
- A retry of the same committed transaction returns the same receipt identity or a deterministic already-issued result; it must not create a second economic effect.
- A different payload reusing an idempotency key is a hard conflict.
- Bind receipts to immutable committed transaction version and exact order/fill identifiers; reject cross-account, cross-asset, cross-order and cross-fill substitution.
- Use database commit/version ordering as the transaction order. Wall-clock timestamps alone are not an ordering authority.
- Define key activation, expiry, revocation and historical verification policy. A revoked key must not sign new receipts; historical signatures remain verifiable only under an explicit audited revocation policy.
- Reversal/refund/correction is a new linked transaction with its own receipt and reference to the original. Never mutate or delete the original receipt.

## 7. Asset-specific meaning

- **Equity:** Receipt may attest to the committed simulated equity fill, charges and virtual cash/position effects.
- **Futures:** Receipt may attest to the committed simulated futures fill, charges, margin and virtual P&L effects. It does not attest to exchange-cleared settlement.
- **Options:** Receipt may attest to the committed simulated option fill, premium, charges, reservation and virtual P&L effects. It does not attest to exercise, expiry or clearing settlement by an external party.
- No internal receipt may be used to claim that real money moved, real margin was posted, or an exchange/clearing corporation settled a trade.

## 8. Failure policy

Fail closed for receipt verification on missing/unknown issuer or key, unsupported algorithm/schema, invalid signature, malformed canonical payload, unsafe arithmetic, non-INR currency where INR is required, expired/not-yet-valid key, revoked key, timestamp/sequence conflict, duplicate/replayed ID, account/order/fill mismatch, amount/direction mismatch, or unavailable authoritative transaction provenance.

Do not infer missing amounts, opening balances, fees, taxes, reservations, P&L, reversals, refunds or settlement. Do not auto-repair balances. A failed receipt blocks receipt verification and reconciliation attestation; it does not authorize a compensating ledger write.

## 9. Required implementation and acceptance gates

Before implementation:
1. Approve the issuer identity, operational owner, threat model and KMS/HSM provider.
2. Approve algorithm, canonicalization, key registry, rotation/revocation and historical verification policy.
3. Confirm exact existing transaction identifiers and safe extension points in the current authenticated Paper Trading write path.
4. Threat-model compromised API credentials, compromised worker, database privilege abuse, signer misuse, replay, key compromise and outbox retries.
5. Review privacy, retention, audit access and incident-response requirements.

Before production activation:
1. Implement only as an isolated extension of the existing Paper Trading transaction architecture; no parallel ledger.
2. Add positive/negative cryptographic tests using real test keys and independent verification, never string-equality signature mocks as proof.
3. Test duplicate/replay, altered payload, wrong account/order/fill, key rotation/revocation, worker retry, outbox delay, signer outage, database rollback and concurrent requests.
4. Prove no client can request arbitrary signing and no receipt path can post or repair balances.
5. Run exact-head CI, independent security review and hosted schema/function parity review.
6. Obtain explicit release approval. Keep `ledgerReconciled=false` until full source-history reconciliation and zero unexplained differences are independently demonstrated.

## 10. Current state

A first isolated Node.js Ed25519 verification primitive has now been added to the Chat 73 audit branch at `market-gateway/lib/paper-trading-simulation-receipt-verifier.js`, with generated-key cryptographic tests in `market-gateway/test/paper-trading-simulation-receipt-verifier.test.js`. It uses the Node crypto implementation to verify detached signatures over a deterministic, sorted-key JSON serialization of an integer-only payload subset; it checks explicit simulation/INR labels, environment, issuer/key binding, key validity/revocation, public-key-only PEM input, timestamps, and exact account/asset/instrument/side/product/order/fill/source-transaction/source-snapshot/transaction-version bindings. It also compares every signed integer-paise amount with the expected values supplied from the authoritative committed transaction. Unknown payload/amount fields, unsafe integers, oversized signatures/payloads and mismatches are rejected.

This is a **verification primitive only**, not a production receipt system:
- No signer or KMS/HSM adapter is implemented; no private key is stored or provisioned.
- No production issuer/key registry is configured. The verifier accepts a registry object supplied by its future trusted server bootstrap; it is not yet wired to one.
- The canonicalizer is a constrained project serialization, not yet independently certified against a complete RFC 8785 conformance suite.
- Durable replay prevention still requires database uniqueness/consumption semantics; the primitive explicitly reports that replay protection is external.
- No transaction RPC, balance, margin, reservation, position, receipt table, hosted function or browser path calls this module. It cannot authorize accounting postings.
- No external exchange/clearing settlement integration is implemented.

Before any production integration, add a managed KMS/HSM signer adapter, audited server-owned key registry, canonicalization conformance vectors, durable idempotent receipt storage/outbox, independent security review, and exact-head CI. Keep all signing credentials out of the client and repository.

**Current decision remains BLOCKED.** No production migration, hosted function, balance, account, settlement or deployment was changed. The independent Demo reducer remains Demo-only and must continue to return `ledgerReconciled=false`.
