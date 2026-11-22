# Firebase Firestore → Supabase Field-Level Mapping

**Audit date:** 2026-11-22  
**Source baseline:** `integration/paper-trading-backend-main-2026-11-20` (PR #28 head `6aa3ac3f80da49712ed0bc10ed8d4c103bbeccdd`)  
**Target design:** PR #70 head `f58479985d4efefcf0f5295d67111f505fb7c470`  
**Status:** Source-derived mapping proposal; no production export/import performed.

This document records the observed Firebase fields and proposed destination semantics. It is not an instruction to run SQL or migrate live records. Where a legacy field is optional, the migration must preserve NULL/absence or apply only the exact compatibility default confirmed by the Firebase reader/writer; do not blanket-fill zero.

## 1. Identity and conversion rules

| Legacy identity/value | Destination | Required handling |
|---|---|---|
| Firebase Auth UID (string) | `paper_user_identity_map.firebase_uid` plus Supabase Auth UUID | Keep original UID immutable and unique. Resolve only through trusted server-side mapping. |
| Supabase Auth UUID | `paper_accounts.user_id` and related user FK | Must refer to provisioned/verified Supabase Auth identity; never cast Firebase UID to UUID. |
| Firestore document ID | Legacy source ID / destination key | Preserve source ID in migration ledger. Cash/derivative order IDs are 64-char lowercase SHA-256 hex and should remain identical. |
| Integer `*Paise` | PostgreSQL bigint `*_paise` | Preserve integer paise exactly. Do not convert through floating-point rupees. |
| Firestore Timestamp | timestamptz | Convert from seconds/nanos using UTC; preserve original source value in ledger if sub-millisecond precision exists. |
| Epoch `*Ms` | bigint `*_ms` | Keep milliseconds as integer; do not reinterpret as seconds or timestamptz. |
| Missing legacy field | Nullable/default only when verified | Use reader compatibility rules below; record whether synthesized. |
| Firestore map keyed by instrument key | normalized child rows | Preserve exact instrument key and product partition. Detect duplicate keys before import. |

## 2. Account document: `indianPaperAccounts/{firebaseUid}`

Observed create shape from `ensurePaperAccount`:

| Firestore field | Type / semantics | Supabase target | Transform / default |
|---|---|---|---|
| document ID | Firebase UID | identity map FK | Never discard original UID |
| `currency` | string, must be `INR` | `paper_accounts.currency` | Preserve; reject unexpected currency |
| `startingCashPaise` | safe integer | `paper_accounts.starting_cash_paise` | Preserve historical value; do not reset to current default |
| `cashPaise` | safe integer | `paper_accounts.cash_paise` | Preserve exact |
| `reservedCashPaise` | safe integer, legacy default 0 when absent | `paper_accounts.reserved_cash_paise` | Missing → 0 only if account reader confirms legacy default |
| `reservedMarginPaise` | safe integer, legacy default 0 when absent | `paper_accounts.reserved_margin_paise` | Missing → 0 only if reader confirms; current options execution rejects nonzero margin reserve |
| `realizedPnlPaise` | safe integer, legacy default 0 | `paper_accounts.realized_pnl_paise` | Preserve aggregate realized P&L |
| `deliveryRealizedPnlPaise` | safe integer; absent fallback = legacy aggregate realized P&L | `paper_accounts.delivery_realized_pnl_paise` | Apply fallback only to rows missing this field |
| `intradayRealizedPnlPaise` | safe integer; absent fallback = 0 | `paper_accounts.intraday_realized_pnl_paise` | Apply fallback only to rows missing this field |
| `positions` | map keyed by instrument | `paper_equity_positions`, product `DELIVERY` | Flatten each entry |
| `intradayPositions` | map keyed by instrument | `paper_equity_positions`, product `INTRADAY` | Flatten separately; never merge with Delivery |
| `derivativePositions` | map keyed by instrument | `paper_derivative_positions` | Flatten separately from equity |
| `reservedPositions` | map instrument → reserved share quantity | `paper_equity_positions.reserved_quantity`, product `DELIVERY` | Join by exact key; missing map → empty map |
| `intradayReservedPositions` | map instrument → reserved share quantity | `paper_equity_positions.reserved_quantity`, product `INTRADAY` | Join by exact key; missing map → empty map |
| `version` | positive integer; account creation starts at 1 | `paper_accounts.version` | Preserve; missing legacy version requires explicit backfill policy, not silent assumption |
| `createdAt` | Firestore Timestamp | `created_at` | Preserve timestamp |
| `updatedAt` | Firestore Timestamp | `updated_at` | Preserve timestamp |

Starting cash configuration defaults to 100,000,000 paise (₹10,00,000) for newly created accounts. This is NOT a valid backfill value for existing accounts.

Account invariants:
- `cashPaise >= 0`; `reservedCashPaise + reservedMarginPaise <= cashPaise`.
- All money and P&L fields are safe integer paise.
- Preserve one shared cash balance across Delivery, Intraday and options.
- Account version increments on transactional state changes and is used to detect stale/inconsistent state.

## 3. Cash-equity position maps

For each entry under `positions` and `intradayPositions`:

| Map entry field | Destination | Notes |
|---|---|---|
| map key | `paper_equity_positions.instrument_key` | Exact provider instrument key |
| `quantity` | `quantity` | Integer 0..1,000,000; zero rows may be deleted/omitted only if equivalent state is preserved |
| `averagePricePaise` | `average_price_paise` | Integer paise |
| `costBasisPaise` | `cost_basis_paise` | Optional in legacy rows; fallback is quantity × average price, only if safe integer |
| `tradingSymbol` / display metadata if present | `trading_symbol` | Preserve optional metadata; confirm exact source on all historical rows |
| `exchange` if present | `exchange` | Preserve optional metadata |

The product column is `DELIVERY` for `positions`, `INTRADAY` for `intradayPositions`. The two maps have separate reservations and realized P&L fields but share account cash.

Position invariants:
- quantity and average price are nonnegative safe integers; positive quantity requires positive average price.
- cost basis is safe integer, positive for an open position, zero for an empty position.
- for open positions, `round(cost_basis / quantity) = average_price`.
- reservation quantity is an integer between zero and held quantity.

## 4. Cash-equity orders: `indianPaperOrders/{sha256OrderId}`

Observed order write/response fields (not every historical row is guaranteed to contain every optional property):

| Firestore field | Supabase `paper_orders` field | Notes |
|---|---|---|
| document ID | `order_id` | Preserve 64-char SHA-256 hex |
| `uid` | `user_id` via identity map | Ownership must be checked server-side |
| `requestFingerprint` | `request_fingerprint` | SHA-256 normalized request |
| original UUID idempotency key | `idempotency_key` | Current legacy cash order document does not persist this raw key; historical import cannot reconstruct it |
| `instrumentKey` | `instrument_key` | Exact provider key |
| `tradingSymbol` | `trading_symbol` | Display value |
| `exchange` | `exchange` | Exchange |
| `side` | `side` | BUY / SELL |
| `product` | `product` | DELIVERY / INTRADAY; old Delivery MARKET fingerprint omits product by design |
| `orderType` | `order_type` | MARKET / LIMIT |
| `status` | `status` | FILLED / PENDING / CANCELLED (verify full historical enum before import) |
| `quantity` | `quantity` | Integer |
| `executionPricePaise` | `execution_price_paise` | MARKET filled price or LIMIT fill price |
| `limitPricePaise` | `limit_price_paise` | LIMIT only |
| `grossPaise` | `gross_paise` | Execution price × quantity |
| `realizedPnlPaise` | `realized_pnl_paise` | Per-order realized P&L |
| `quoteTimestampMs` | `quote_timestamp_ms` | Provider quote observation time in ms |
| `quoteAgeMs` | `quote_age_ms` | Age at execution |
| `simulationOnly` | `simulation_only` | Must remain true |
| `reservedCashPaise` | `reserved_cash_paise` | LIMIT BUY reserve; MARKET often absent |
| `reservedQuantity` | `reserved_quantity` | LIMIT SELL share reserve |
| `reservationReleased` | `reservation_released` | LIMIT lifecycle safety flag |
| `filledAt` | `filled_at` | Firestore Timestamp |
| `cancelledAt` | `cancelled_at` | Firestore Timestamp |
| `createdAt` | `created_at` | Firestore Timestamp |
| `updatedAt` | `updated_at` | Firestore Timestamp |
| `workerExecution` | `worker_execution` if target has field | Distinguishes scheduled worker fill |
| `orderId` if embedded | `order_id` | Document ID is canonical; compare if both exist |

### Cash-equity idempotency compatibility

- Current order ID = lowercase hex SHA-256 of `firebaseUid + ":" + client UUID idempotency_key`.
- Request fingerprint = SHA-256 of JSON.stringify normalized order intent.
- MARKET fingerprint uses `{instrumentKey,side,quantity}`; INTRADAY adds `product:"INTRADAY"`; Delivery preserves the legacy payload without product.
- LIMIT fingerprint includes `instrumentKey,side,quantity,orderType,limitPricePaise`, plus product only for Intraday (which is currently rejected by policy).
- Same ID + same fingerprint replays prior order; same ID + different fingerprint rejects with conflict.
- For migrated historical orders, preserve order ID and fingerprint, set raw `idempotency_key` NULL if target permits, and enforce uniqueness only for non-NULL newly generated keys. Do not invent a UUID.

## 5. LIMIT order lifecycle fields

Additional observed fields on pending LIMIT order:

| Field | Meaning |
|---|---|
| `limitPricePaise` | User's limit |
| `reservedCashPaise` | BUY reserve = limit × quantity; SELL = 0 |
| `reservedQuantity` | SELL reserve = quantity; BUY = 0 |
| `status` | PENDING → FILLED or CANCELLED |
| `reservationReleased` | true after fill/cancel |
| `executionPricePaise` | Actual fresh quote at fill |
| `grossPaise` | Fill quote × quantity |
| `quoteTimestampMs`, `quoteAgeMs` | Freshness evidence |
| `filledAt`, `cancelledAt`, `updatedAt` | Lifecycle timestamps |
| `workerExecution` | Worker-originated fill marker |

Compatibility checks:
- Only Delivery LIMIT orders are supported; Intraday LIMIT remains rejected.
- BUY reserves cash atomically; SELL reserves available Delivery quantity atomically.
- Fill requires a fresh, non-future quote (max 15 seconds) and limit threshold crossing.
- Fill/cancel/retry must lock the account and order in a deterministic order and atomically release reservation exactly once.
- Existing SQL LIMIT fill RPC accepts a price input; trusted gateway/worker must enforce provider quote freshness and ownership before invoking privileged RPC. Never expose a caller-controlled raw execution price RPC to end users.

## 6. Derivative position map: `derivativePositions`

| Firestore field | Supabase `paper_derivative_positions` | Notes |
|---|---|---|
| map key | `instrument_key` | Exact contract instrument key |
| `instrumentType` | `instrument_type` | CE / PE in currently enabled route |
| `netQuantity` | `net_quantity` | Current long quantity; shorts disabled |
| `averagePricePaise` | `average_price_paise` | Fee-inclusive average for long options |
| `costBasisPaise` | `cost_basis_paise` | Legacy fallback = netQuantity × averagePricePaise if absent and safe |
| `exchange` | `exchange` | NSE / BSE |
| `segment` | `segment` | Provider segment |
| `expiry` | `expiry` | Contract expiry date |
| `lotSize` | `lot_size` | Positive integer |

Only CE/PE long positions are currently executed by the route. Do not enable futures/shorts simply because the low-level generic position calculator contains FUT/short arithmetic.

## 7. Derivative orders: `indianDerivativeOrders/{sha256OrderId}`

| Firestore field | Supabase `paper_derivative_orders` | Notes |
|---|---|---|
| document ID | `order_id` | Preserve exact SHA-256 ID |
| `uid` | `user_id` via identity map | Owner |
| `requestFingerprint` | `request_fingerprint` | Preserve |
| original UUID key | `idempotency_key` | Recoverable only if separately logged; otherwise nullable legacy |
| `instrumentKey` | `instrument_key` | Exact provider key |
| `tradingSymbol` | `trading_symbol` | Display symbol |
| `exchange` | `exchange` | NSE / BSE |
| `segment` | `segment` | Contract segment |
| `instrumentType` | `instrument_type` | CE / PE |
| `expiry` | `expiry` | Contract expiry |
| `side` | `side` | BUY / SELL-to-close |
| `quantity` | `quantity` | Contract units |
| `lots` | `lots` | Number of lots |
| `lotSize` | `lot_size` | Contract lot size |
| `executionPricePaise` | `execution_price_paise` | Fresh quote |
| `quoteTimestampMs` | `quote_timestamp_ms` | Quote observation epoch ms |
| `quoteAgeMs` | `quote_age_ms` | Quote age at execution |
| `grossPaise` | `gross_paise` | Contract value |
| `charges` object | `charges_breakdown` JSONB | Preserve component names and paise amounts exactly |
| `chargesPaise` | `charges_paise` | Total |
| `totalDebitPaise` | `total_debit_paise` | BUY total debit |
| `netCreditPaise` | `net_credit_paise` | SELL net credit |
| `orderType` | `order_type` | MARKET |
| `status` | `status` | FILLED |
| `realizedPnlPaise` | `realized_pnl_paise` | Per-order net realized P&L |
| `cashDeltaPaise` | `cash_delta_paise` | Option premium cash movement before charges |
| `simulationOnly` | `simulation_only` | true |
| `excludesCharges` | `excludes_charges` | false for route-generated long option orders |
| `createdAt` | `created_at` | Firestore Timestamp |

Charge breakdown must retain fields: `brokeragePaise`, `exchangeTransactionPaise`, `ipftPaise`, `sebiPaise`, `stampDutyPaise`, `gstPaise`, `sttPaise`, `totalChargesPaise`, `totalDebitPaise`, `netCreditPaise`. Do not recompute historical charges during import.

## 8. Watchlists and auxiliary private collections

### `indianMarketWatchlists/{firebaseUid}`

- `watchlists` is an object with the fixed names `My Stocks`, `Banking`, `NIFTY`, `F&O`.
- Each value is an ordered array of instrument-key strings, deduplicated and capped at 50.
- Legacy `instrumentKeys` is fallback for `My Stocks` when `watchlists["My Stocks"]` is absent.
- Target `paper_watchlists` rows should include mapped user, watchlist name, instrument key, and stable ordinal/position. Preserve order; do not sort alphabetically.

### `upstoxConnections/{firebaseUid}`

Observed sensitive envelope is encrypted AES-256-GCM JSON (`v`, `iv`, `tag`, `data`) with non-secret provider/status/token metadata and expiry. Keep ciphertext byte-for-byte and keep encryption key in secret manager. Never export plaintext access token or encryption key. Confirm exact full record shape against the current writer and historical records before any real migration.

### `upstoxOAuthStates/{state}`

Observed state record contains `uid`, `used`, `expiresAt`; callback consumes it before token exchange. The raw state is a bearer-like secret: destination should store a cryptographic hash, not raw state. Preserve single-use and 10-minute expiry semantics; migration of outstanding state records is not recommended—expire/restart OAuth instead.

### `upstoxConnectionControls/{firebaseUid}`

- `generation`: nonnegative integer, monotonically incremented on disconnect / reconnect lifecycle.
- `updatedAtMs`: epoch milliseconds.
- Preserve generation to prevent stale OAuth callback from resurrecting a disconnected connection.

### `indianMarketStreamLeases/{firebaseUid}`

- `leaseId`, `expiresAtMs`, `updatedAtMs`, `revoked` observed/used by stream lease logic.
- Preserve epoch milliseconds and revocation state. Active leases should normally be recreated, not imported as live ownership.

### `indianMarketWorkerState/pendingLimitOrders`

- `cursorOrderId`, `updatedAt`.
- Cursor is operational state, not user financial data. Prefer restart/rescan from pending order index after migration rehearsal; preserve audit copy.

### `indianMarginPreviewLimits/{firebaseUid}`

- `lastRequestAtMs`, `updatedAtMs`; cooldown default 5,000 ms.
- This is rate-limit state. It may be safely reset only under an explicit migration policy and after rate-limit abuse/security review.

## 9. PR #70 target-schema parity review: items requiring correction or proof

These are review findings against the draft SQL design, not edits:

1. **Cash-equity legacy idempotency key:** Firebase cash order docs persist `requestFingerprint` but not original UUID key. PR #70's non-null `idempotency_key` requirement needs nullable legacy import support or a separate migration-only legacy key strategy that does not fabricate a client UUID. Preserve `order_id` and fingerprint as the durable replay identity.
2. **LIMIT execution freshness:** SQL fill function validates limit threshold and status/reservation, but the trusted caller must validate authenticated owner and quote timestamp/freshness (≤15 sec, not future) before RPC. SQL function should ideally receive and validate quote timestamp / bounded execution evidence, not accept arbitrary price from an untrusted caller.
3. **Delivery/Intraday P&L:** Ensure SQL account initialization/backfill preserves legacy `deliveryRealizedPnlPaise` fallback to aggregate realized P&L and missing Intraday value fallback to zero. Never overwrite nonzero historical values.
4. **Position cost basis:** Legacy position rows may omit `costBasisPaise`; fallback is quantity × average price only when safe and consistent. Import validation must report malformed/inconsistent rows rather than silently normalize.
5. **Starting capital:** Existing account starting cash is user-specific historical state; default ₹10,00,000 applies only to new account creation. SQL initialization must not reset an existing account.
6. **OAuth outstanding states and stream leases:** Do not carry over live OAuth states or live stream leases as valid. Expire outstanding OAuth states and recreate stream lease on reconnect.
7. **Worker state:** A stale cursor may skip newly inserted pending orders if naively carried forward. Restart with a full pending-order scan/reconciliation at cutover or use a durable queue/cursor strategy with proven wraparound.
8. **Charges:** Preserve historical JSONB charge breakdown and stored totals; do not recalculate using current fee schedule.
9. **Account version:** Historical rows missing `version` need explicit policy; initializing every existing row to 1 can break stale-write detection and is not equivalent to preserving transaction history.
10. **RLS/service role:** Public client must never call privileged fill/submit RPC with arbitrary `p_user_id`, price or provider contract metadata. Verify execute grants, RLS, function search_path, and server-side ownership resolution before staging tests.

## 10. Pre-import reconciliation checklist

- [ ] Snapshot/export timestamp, source project identity and export checksum recorded.
- [ ] Counts per collection and per user recorded.
- [ ] Every account maps to exactly one verified Supabase UUID; no duplicate Firebase UID or Supabase UUID.
- [ ] Cash, starting cash, reserved cash, reserved margin, aggregate/Delivery/Intraday realized P&L match exactly in paise.
- [ ] Delivery, Intraday and derivative positions match by instrument key, product, quantity, average and cost basis.
- [ ] Reservations do not exceed held shares or cash.
- [ ] Orders match by order ID, status, side, product, type, quantity, prices, gross, P&L and timestamps.
- [ ] Every existing order ID and request fingerprint is unique and preserved.
- [ ] Legacy cash order UUID idempotency key remains NULL where unrecoverable; no fabricated values.
- [ ] Options charge breakdown and totals match byte/field-level values.
- [ ] Watchlist names, keys, de-duplication and ordering match.
- [ ] OAuth ciphertext only; no plaintext tokens, raw OAuth state or secrets in export logs.
- [ ] Worker cursor/leases are restarted or intentionally restored under approved policy.
- [ ] Import dry-run is repeatable and idempotent; rejected rows have a remediation report.
- [ ] No production writes occur during audit or staging rehearsal.

## 11. Source files reviewed

- `market-gateway/lib/paper-account-config.js`
- `market-gateway/lib/paper-account-state.js`
- `market-gateway/lib/paper-order-transaction.js`
- `market-gateway/lib/pending-limit-order-transaction.js`
- `market-gateway/lib/pending-limit-order.js`
- `market-gateway/lib/order-idempotency.js`
- `market-gateway/lib/paper-math.js`
- `market-gateway/lib/paper-order-response.js`
- `market-gateway/lib/product-mode.js`
- `market-gateway/lib/derivative-order-transaction.js`
- `market-gateway/lib/derivative-position.js`
- `market-gateway/lib/trading-charges.js`
- `market-gateway/lib/watchlists.js`
- `market-gateway/lib/margin-preview-rate-limit.js`
- `functions/lib/upstox-oauth-state.js`
- `functions/lib/upstox-disconnect.js`
- `functions/lib/pending-limit-order-worker.js`
- PR #70 draft migrations 001–005 (read-only inspection only)
