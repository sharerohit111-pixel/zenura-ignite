# S-TRADE Chat 73 — Authoritative Ledger Export Intake Specification

**Purpose:** Collect the minimum evidence required for an independent, read-only Paper Trading ledger reconciliation.
**Scope:** Indian-market Paper Trading Equity, Futures and Options only. Retired Paper Investing is excluded.
**Status:** Intake contract only. It does not assert that the source data exists or authorize database changes.

## 1. Safety and extraction rules

- Extract from every authoritative source that ever held Paper Trading account, order, execution, charge, reservation, position, correction or settlement facts, including any verified legacy source and migration/cutover source.
- Use a read-only, transactionally consistent snapshot where supported. Record the exact snapshot mechanism and consistency guarantees.
- Preserve source values exactly. Do not synthesize missing rows, infer opening balances, regenerate IDs, repair timestamps, or calculate replacement balances during extraction.
- Use opaque account identifiers. Exclude names, phone numbers, email addresses, addresses, authentication records, passwords, access tokens, API keys, service-role keys and other secrets.
- Do not export unrelated users' records. Keep each account's records consistently pseudonymized with the same stable opaque key across all files.
- Export timestamps in UTC ISO 8601 with explicit `Z` or offset. Preserve original source timestamp and timezone metadata if the source stores them.
- Money must be integer paise, never floating-point rupees. Quantities and prices must use explicitly documented integer units/scales; do not assume paise is the unit for instrument prices.
- Empty, unavailable, not-applicable and zero are distinct values. Do not replace missing data with zero.
- Include deleted/soft-deleted rows and tombstones if they are part of the source's accounting history. Record retention limits and known gaps.
- Do not send credentials or secrets with the export. Deliver files through an approved private channel.

## 2. Required files and minimum fields

The names below are suggested stable filenames. If a source uses different table or field names, retain the original names in the manifest and provide a documented mapping; do not alter source facts.

### `accounts.csv` — account identity and opening provenance

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `account_currency`
- `created_at_utc`, `updated_at_utc`, `deleted_at_utc` (nullable)
- `opening_cash_paise` (only when directly stored or supported by a source event)
- `opening_cash_source_type`, `opening_source_event_id`, `opening_source_version`
- `opening_idempotency_key`, `opening_recorded_at_utc`
- `current_cash_paise`, `reserved_cash_paise`, `reserved_margin_paise` (snapshot values, not inferred)
- `account_version` or equivalent source concurrency/version marker

If opening provenance is not recorded, leave the fields absent/null and document that fact. Never infer it from current cash.

### `orders.csv` — all order lifecycle states

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `order_id`, `client_order_id` (nullable)
- `asset_class` (EQUITY/FUTURES/OPTIONS), `exchange`, `instrument_id`, `symbol`, `expiry`, `strike`, `option_type` (nullable where inapplicable)
- `side`, `product_type`, `order_type`, `time_in_force`
- `requested_quantity`, `filled_quantity`, `cancelled_quantity`, `rejected_quantity`
- `limit_price_units`, `trigger_price_units`, `average_fill_price_units`, `price_scale`
- `status`, `status_reason`, `created_at_utc`, `updated_at_utc`, `submitted_at_utc`, `completed_at_utc`, `cancelled_at_utc`, `expired_at_utc`
- `idempotency_key`, `request_fingerprint`, `source_transaction_id`, `account_version`

### `fills.csv` — immutable execution/fill facts

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `fill_id`, `order_id`, `source_transaction_id`, `execution_id`
- `asset_class`, `exchange`, `instrument_id`, `side`
- `fill_quantity`, `fill_price_units`, `price_scale`
- `gross_notional_paise`, `currency`, `fill_at_utc`, `recorded_at_utc`
- `idempotency_key`, `transaction_version`, `supersedes_fill_id` (nullable)

One row per actual persisted fill. If fills are currently embedded in order rows and no independent fill IDs exist, export the raw order representation separately and document the limitation; do not manufacture fill IDs.

### `charges.csv` — fee, tax and adjustment breakdown

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `charge_id`, `source_transaction_id`, `order_id`, `fill_id` (nullable as appropriate)
- `asset_class`, `charge_code`, `charge_name`, `amount_paise`, `currency`
- `calculation_version`, `rate_or_rule_reference`, `recorded_at_utc`
- `reversal_of_charge_id` (nullable), `idempotency_key`

Keep each charge/tax component separate. Include credits and negative adjustments exactly as stored.

### `reservations.csv` — blocked-funds and margin lifecycle

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `reservation_id`, `order_id`, `source_transaction_id`
- `asset_class`, `reservation_type` (cash/margin/shares/other), `event_type` (reserve/adjust/release/consume/expire)
- `amount_paise` (or documented integer share quantity for share reservations), `currency`
- `created_at_utc`, `event_at_utc`, `recorded_at_utc`, `reservation_status`
- `idempotency_key`, `reservation_version`, `reversal_of_event_id` (nullable)

Export each lifecycle event, not only the current reserved total. If only current-state totals exist, identify that as a material history gap.

### `positions_snapshots.csv` — persisted position and cost-basis snapshots

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `snapshot_id`, `snapshot_at_utc`, `account_version`
- `asset_class`, `exchange`, `instrument_id`, `symbol`, `expiry`, `strike`, `option_type`
- `net_quantity`, `average_cost_price_units`, `price_scale`, `cost_basis_paise`
- `realized_pnl_paise`, `unrealized_pnl_paise` (only if stored), `mark_price_units`, `mark_price_at_utc`
- `source_fill_watermark` or equivalent last-included fill/version marker

Provide every available historical snapshot, not only the latest. State whether each value is persisted, derived, or a mark-to-market estimate.

### `account_snapshots.csv` — transactionally consistent account state

Required fields:
- `source_system`, `opaque_account_id`, `snapshot_id`, `snapshot_at_utc`
- `cash_paise`, `reserved_cash_paise`, `reserved_margin_paise`
- `account_version`, `database_snapshot_id` or equivalent consistency token
- `included_through_transaction_id` or source watermark

The snapshot must correspond to the same consistent cut as orders, fills, charges, reservations and positions. If this cannot be guaranteed, explicitly state that the files are not a consistent snapshot.

### `adjustments.csv` — reversals, refunds, corrections and manual adjustments

Required fields:
- `source_system`, `source_table`, `source_row_id`
- `opaque_account_id`, `adjustment_id`, `adjustment_type`, `reason_code`, `reason_text_redacted`
- `original_transaction_id`, `original_order_id`, `original_fill_id`
- `amount_paise`, `currency`, `quantity_delta` (nullable)
- `created_at_utc`, `effective_at_utc`, `recorded_at_utc`
- `idempotency_key`, `approval_reference` (opaque), `source_version`

Include all reversal/refund/correction links. Preserve orphan references for reconciliation; do not silently discard them.

### `settlement_evidence.csv` — only where an external settlement claim is made

Required fields:
- `source_system`, `opaque_account_id`, `evidence_id`, `source_transaction_id`, `order_id`, `fill_id`
- `settlement_type`, `external_authority`, `external_reference`, `instrument_id`, `quantity`, `amount_paise`, `currency`
- `settlement_status`, `effective_at_utc`, `received_at_utc`
- `evidence_uri_or_private_file_id`, `evidence_sha256`, `verification_method`, `verified_by_role`, `verified_at_utc`

An internal Paper Trading simulation receipt must be labelled internal/simulated and must not be presented as exchange, clearing, bank or real settlement evidence. If no external settlement is claimed, state `not_applicable` and do not fabricate this file.

## 2A. Existing Firebase legacy export — known coverage limit

The repository currently contains `market-gateway/scripts/firebase-readonly-export.js`. Its allowlist is exactly:
- `indianPaperAccounts`
- `indianPaperOrders`
- `indianDerivativeOrders`
- `indianMarketWatchlists`
- Firebase Auth UID-only identity records for orphan validation

It explicitly excludes profile collections and broker/payment/operational collections. The companion `firebase-to-supabase-transform.js` is an offline transformer; its tests assert `supabaseWrites=0` and `importPerformed=false`. Neither script is being executed as part of this audit.

**This existing exporter is a legacy-source candidate, not a complete ledger export.** Its manifest records per-file counts and SHA-256 hashes and its Firestore reader paginates by document name, but the inspected implementation does not establish one transactionally consistent snapshot across collections or export every cursor/page boundary. The allowlisted legacy collections do not provide separate immutable fill, per-charge, reservation-event, reversal/refund or settlement histories. The account document contains current account/position state and starting cash fields, but the existence of a field alone does not establish independently verifiable opening-balance provenance.

If this exporter is later run by an authorized operator, retain its raw output unchanged and privately protect the UID-bearing identity file. Do not treat its `importAllowed` transformer result as a financial reconciliation attestation or perform an import. Obtain additional authoritative source records for every missing lifecycle domain, and document the consistency gap and retention limits. No credentials are requested in this audit.

## 3. Export manifest — `manifest.json`

Include:
- Project identifier and environment (no credentials); extraction tool and version; extraction operator role (not personal contact details).
- Snapshot start/end time in UTC; database snapshot/transaction identifier; isolation level and consistency method.
- Exact source systems, schemas, tables, views and columns included; explicit excluded tables and reason.
- Per file: filename, row count, byte size, SHA-256, encoding, delimiter, header presence, null representation and schema version.
- Pagination method, page size, every cursor/page range, completion marker and proof that extraction reached the end.
- Source retention start date, oldest available record timestamp, known deletions, archival sources and known gaps.
- Field mapping from source columns to this intake specification, including integer units/scales and currency.
- Whether the export includes soft-deleted records, historical versions and audit logs.
- Explicit statement of any unavailable field, unavailable table, truncation, failed page, non-repeatable read or snapshot inconsistency.

Example structure (replace placeholders with actual observed metadata; never use these as asserted values):

```json
{
  "specification": "S-TRADE-CHAT73-EXPORT-1.0",
  "project": "zenura-paper-trading",
  "environment": "REDACTED_ENVIRONMENT_LABEL",
  "snapshot": {
    "started_at_utc": "ACTUAL_TIMESTAMP",
    "completed_at_utc": "ACTUAL_TIMESTAMP",
    "consistency_method": "ACTUAL_METHOD",
    "snapshot_id": "ACTUAL_OPAQUE_ID"
  },
  "files": [
    {
      "name": "orders.csv",
      "row_count": 0,
      "bytes": 0,
      "sha256": "ACTUAL_SHA256",
      "pagination_complete": true
    }
  ],
  "known_gaps": [],
  "excluded_sources": []
}
```

The example's zero count is a placeholder only, not a statement about any real source.

## 4. Independent reconciliation checks after intake

The reconciliation must be read-only and deterministic, and report per account and asset class:

1. Source completeness: expected versus exported tables, rows, pages, date ranges, versions and hashes.
2. Identity integrity: duplicate IDs, duplicate idempotency keys, missing IDs, orphan order/fill/charge/reservation references and conflicting versions.
3. Opening provenance: every opening balance linked to a verifiable source event or authoritative initialization record.
4. Cash conservation: opening cash plus signed persisted cash movements equals closing cash, with every movement tied to committed transactions and charge components.
5. Position conservation: opening quantity plus BUY fills minus SELL fills equals closing quantity, with cost-basis and realized-P&L rules documented per asset.
6. Reservation conservation: reserve/adjust/release/consume/expire events reconcile to closing blocked cash, margin and share reservations.
7. Corrections: original transactions plus explicitly linked reversals/refunds/corrections equal the corrected final state; no implicit overwrites.
8. Snapshot parity: account, order, fill, charge, reservation and position snapshots share a verifiable consistent cut/watermark.
9. Integer arithmetic: all money totals in paise; no floating-point calculations; price/quantity scales explicit.
10. Settlement scope: internal simulation evidence separated from authenticated external settlement evidence.

Output must include source file hashes, row counts, unmatched/conflicting IDs, per-equation totals and exact unexplained difference. Any missing source coverage, unverifiable opening provenance, inconsistent snapshot, ambiguous unit, missing link or unexplained non-zero difference means **BLOCKED**.

## 5. Stop conditions and decision

- Do not create opening balances or synthesize missing events to make equations balance.
- Do not run repair SQL, migrations, RPCs, writes, backfills, or hosted functions during extraction or reconciliation.
- Do not infer historical activity from current-state rows or infer completeness from zero rows.
- Do not accept a Demo event stream, mock receipt, CI fixture, generated key or internal simulation receipt as a substitute for authoritative persisted transaction history.
- Keep `ledgerReconciled=false` until complete authoritative coverage, verified opening provenance, a consistent snapshot and zero unexplained differences have been independently demonstrated.
