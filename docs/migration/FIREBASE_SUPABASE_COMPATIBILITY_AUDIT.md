# Firebase → Supabase Compatibility Audit

**Date:** 2026-11-22  
**Status:** Read-only source audit; compatibility documentation in progress  
**Audit branch:** `audit/firebase-supabase-compatibility-2026-11-22`  
**Baseline:** PR #28 head `6aa3ac3f80da49712ed0bc10ed8d4c103bbeccdd`  
**Supabase draft:** PR #70 head `f58479985d4efefcf0f5295d67111f505fb7c470`

## 1. Safety boundary and repository state

- PR #28 is OPEN / DRAFT, base `main`, head `integration/paper-trading-backend-main-2026-11-20`.
- PR #70 is OPEN / DRAFT, base is the PR #28 integration branch. Its five SQL migrations are draft-only.
- This audit branch was created from the exact PR #28 head SHA above.
- No Firebase production settings, Functions, rules, secrets, hosting, or live data were changed.
- No Supabase SQL or data was applied. PR #70 and its migration files were not edited.
- No PR was merged or modified. The existing frontend was not changed.

## 2. Firebase backend inventory

### Runtime boundaries

1. Firebase Cloud Functions v2 in `functions/` provide Upstox OAuth lifecycle, connection status/disconnect, premium entitlement checks, and the scheduled pending LIMIT worker.
2. The Node.js 22 Express service in `market-gateway/` is the HTTP API and long-lived Upstox Market Data Feed V3 WebSocket / browser SSE gateway. It uses Firestore for paper state and private connection/lease state.
3. Firestore is the persistence layer. Server-side paper collections are denied direct client access in `firestore.rules`.
4. Browser code in `markets/stocks/` obtains a Firebase ID token and calls the gateway. The existing frontend order workspace supports MARKET and Delivery LIMIT flows; it does not locally simulate fills.

### Cloud Function exports relevant to market / paper trading

| Function | Trigger | Behavior |
|---|---|---|
| `startUpstoxAuthorization` | HTTPS callable | Requires signed-in user and verified password-provider email; creates single-use OAuth state and returns Upstox authorization URL |
| `upstoxOAuthCallback` | HTTPS GET | Consumes OAuth state before exchange; exchanges code; AES-256-GCM encrypts token; saves only if connection generation still matches |
| `disconnectUpstoxAccount` | HTTPS callable | Deletes encrypted connection, revokes stream lease, increments generation to block stale callback |
| `getIndianMarketConnectionStatus` | HTTPS callable | Returns sanitized connection status |
| `processPendingPaperLimitOrders` | Scheduled | Every minute on weekdays in configured 09:00–15:59 schedule; explicit opt-in gate; market-session check; fresh quotes; max 50 scanned orders per run |

Related Functions in `functions/index.js`:
- `getPremiumAccess` initializes/reads trial or premium entitlement.
- `authorizePaperOrder` checks active trial/premium access.
- `createPremiumOrder`, `verifyPremiumCheckout`, and `razorpayWebhook` are subscription/payment functions, not trading execution endpoints.

### HTTP gateway routes

All private routes except `/health` and the instrument-master lookup require Firebase bearer-token authentication as implemented by `market-gateway/lib/firebase-auth.js`. Token verification uses Firebase Admin `verifyIdToken(token, true)`, including revocation/disabled-account checking.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service health |
| GET | `/instruments` | Search cached Upstox BOD instrument master |
| GET | `/candles` | Authenticated historical candle proxy |
| GET | `/option-chain` | Authenticated option-chain proxy |
| GET | `/paper/account` | Shared virtual cash, positions and reservations; initializes account if absent |
| POST | `/paper/orders` | Cash-equity MARKET fill or Delivery LIMIT submission |
| POST | `/paper/orders/:orderId/cancel` | Cancel pending LIMIT and release reservation |
| POST | `/paper/derivative/margin-preview` | Informational futures margin preview; no execution |
| POST | `/paper/derivative/orders` | Long CE/PE option MARKET BUY / SELL-to-close simulation |
| GET | `/paper/portfolio` | Cash-equity portfolio valuation |
| GET | `/paper/derivatives/portfolio` | Derivative portfolio valuation |
| GET | `/paper/derivative/orders` | Derivative order history |
| GET | `/paper/orders` | Cash-equity order history with cursor pagination |
| GET | `/watchlists` | All named user watchlists |
| GET | `/watchlist` | One named watchlist |
| GET | `/watchlist/quotes` | Watchlist quotes |
| PUT | `/watchlist` | Update watchlist |
| POST | `/stream` | Authenticated SSE browser stream backed by upstream Upstox WebSocket |

### Trading behavior confirmed in source

**Cash equity MARKET**
- Supports BUY/SELL, Delivery and Intraday; one shared INR virtual cash account.
- Server obtains a fresh Upstox V3 quote, validates instrument/tick/quote age and performs Firestore transaction.
- Cash equity arithmetic is gross-price based in `paper-math.js`; the inspected MARKET cash-equity fill path does not apply the derivative brokerage/charge schedule.
- Delivery and Intraday positions and realized P&L are separate maps/fields, while cash is shared.

**Cash equity LIMIT**
- Intraday LIMIT is explicitly rejected. Delivery LIMIT only.
- BUY reserves limit-price × quantity from shared available cash. SELL reserves unreserved Delivery shares.
- Pending orders are filled only when a fresh quote (max age 15 seconds) crosses the limit: BUY quote <= limit; SELL quote >= limit. Fill is at the fresh quote price.
- Cancel applies only to pending LIMIT and releases reservations. Fill/cancel/retry paths are transaction-protected.
- Scheduled worker is opt-in gated and is not enabled by default. Preserve this safety gate.

**Options**
- Long CE/PE only: MARKET BUY and SELL-to-close; no short option/futures execution.
- Contract metadata includes instrument key, exchange/segment, expiry, strike, lot size, tick size and lots.
- Fresh quote max age 15 seconds; expiry cutoff 15:30 Asia/Kolkata.
- Indicative charges in paise: ₹20 default brokerage per executed order; NSE exchange transaction 0.03553%, IPFT 0.0005%; BSE exchange transaction 0.0325%, no IPFT; SEBI 0.0001%; buy stamp duty 0.003%; sell STT 0.15%; GST 18% on brokerage + exchange + IPFT.
- Entry charges are included in option position cost basis; SELL charges reduce realized P&L/net credit. These are simulator estimates, not broker contract notes.
- Futures margin preview is informational only and does not reserve margin or open positions.

**Idempotency**
- Client sends UUID `idempotency_key`.
- Cash order ID is SHA-256(`uid:idempotency_key`); request fingerprint is SHA-256 of normalized order intent.
- Stored cash/derivative order documents retain deterministic order ID and request fingerprint; current legacy order document does not persist the original UUID key.
- A same-key/same-fingerprint retry returns the prior result; changed intent under the same key is rejected (409). Account-first Firestore transactions serialize balance/position mutations.
- Legacy Delivery fingerprint deliberately preserves the old JSON payload shape. Do not change hashing/serialization during migration without compatibility vectors.

## 3. Firebase identity and data ownership

- Current identity is Firebase Auth UID, a string. Gateway verifies Firebase ID token server-side and uses decoded `uid` as the Firestore document owner.
- The browser's authenticated identity is also exposed by `ZENURA_MARKET_CONNECTOR.getUserId()`; this is a Firebase UID, not a Supabase UUID.
- Never cast Firebase UID to UUID or assume it equals Supabase Auth `auth.uid()`.
- PR #70 design correctly proposes a private `paper_user_identity_map` mapping provisioned Supabase Auth UUID to legacy Firebase UID. This mapping needs a controlled verified-user provisioning and collision/reconciliation process.
- Firestore rules explicitly deny client reads/writes to OAuth state, Upstox connections, connection controls, stream leases, worker state, watchlists, paper accounts, cash orders, derivative orders, and margin-preview rate limits. Equivalent Supabase private-schema/RLS/service-role boundaries are mandatory.

## 4. Firestore → Supabase mapping

| Firestore source | Supabase draft target | Notes / transformation |
|---|---|---|
| `indianPaperAccounts/{firebaseUid}` | `paper_accounts` | One shared INR account; preserve starting/cash/reserved cash/reserved margin, aggregate + Delivery + Intraday realized P&L, version and timestamps |
| `indianPaperAccounts.positions` | `paper_equity_positions` | Product = DELIVERY; preserve instrument key, quantity, average price and cost basis |
| `indianPaperAccounts.intradayPositions` | `paper_equity_positions` | Product = INTRADAY; separate from Delivery |
| `reservedPositions` / `intradayReservedPositions` | `paper_equity_positions.reserved_quantity` | Preserve reservations by product and instrument |
| `indianPaperOrders/{sha256OrderId}` | `paper_orders` | Preserve exact 64-char order ID, request fingerprint, status, order type, product, prices, gross, P&L, reserve/fill/cancel metadata |
| `indianDerivativeOrders/{sha256OrderId}` | `paper_derivative_orders` | Preserve contract/lot fields, charges breakdown, gross/debit/credit, quote age, realized P&L |
| `indianMarketWatchlists/{firebaseUid}` | `paper_watchlists` | Normalize named watchlists into per-user/per-list rows; preserve keys and ordering |
| `upstoxConnections/{firebaseUid}` | `upstox_connections` | Preserve AES-GCM envelope JSON (v/iv/tag/data), provider/status/token type/expiry; never import plaintext token |
| `upstoxOAuthStates/{state}` | `upstox_oauth_states` | Store hash of raw state, uid mapping, generation, created/expiry/used lifecycle |
| `upstoxConnectionControls/{firebaseUid}` | Private connection-control table | Preserve generation and updated epoch milliseconds |
| `indianMarketStreamLeases/{firebaseUid}` | `paper_market_stream_leases` | Preserve lease ID, expiresAtMs, updatedAtMs and revoked state |
| `indianMarketWorkerState/pendingLimitOrders` | Private worker-state table | Preserve scan cursor and worker control metadata |
| `indianMarginPreviewLimits/{firebaseUid}` | `paper_margin_preview_limits` | Preserve cooldown/rate-limit state |

Amounts are integer paise. Firestore Timestamp values must be converted with timezone-safe semantics; epoch-millisecond fields such as stream lease expiry must remain integer milliseconds. Do not silently reinterpret missing legacy fields as zero until historical documents are profiled.

## 5. Compatibility gaps and risks

1. **Auth transition:** Firebase ID tokens cannot be used as Supabase JWTs. Need verified account linking, mapping, session migration/sign-in strategy, and an overlap period. UID ownership must be resolved server-side.
2. **API contract:** Existing gateway routes and response shapes are Firebase-backed. Supabase schema/RPCs do not by themselves provide drop-in HTTP compatibility. Build an adapter that preserves status codes, response fields, paise units, pagination, and error semantics.
3. **Atomicity:** Firestore transactions must be matched by PostgreSQL transactions with account-first row locking, unique constraints, and tested concurrent behavior. A partial SQL port is not parity.
4. **MARKET quote trust:** Supabase RPC must not trust browser-supplied quote/instrument/price. Trusted server must validate provider instrument and fresh quote before invoking privileged RPC.
5. **LIMIT worker:** Need a separate persistent/scheduled worker runtime, opt-in gate, cursor, fresh quote validation, fill/cancel race protection, and lease recovery. Edge Functions alone are not a replacement for the existing long-lived WebSocket/SSE runtime.
6. **Charges/P&L:** Cash-equity fills currently use gross-only cash/realized P&L; options use indicative charges and fee-inclusive cost basis. Do not apply option charges to equity trades or flatten the distinct accounting semantics.
7. **Idempotency legacy rows:** Original UUID idempotency key is not recoverable from current stored cash order payload. Preserve order ID + fingerprint; nullable legacy key and partial uniqueness for newly generated keys is appropriate.
8. **OAuth security:** Preserve 32-byte random state, 10-minute expiry, single-use consume-before-exchange, connection generation race guard, AES-256-GCM envelope and secret-manager key. Never expose tokens, raw state, or service-role key.
9. **RLS:** All exposed user tables require RLS and explicit owner predicates; trading writes stay server-only. SECURITY DEFINER functions require fixed search_path, minimal grants, and security review.
10. **Runtime:** Upstox WebSocket and SSE require long-lived Node/container runtime. Supabase database/Auth/Edge Functions do not replace that runtime by themselves.
11. **Migration integrity:** Need immutable export snapshot, counts, per-user totals, checksums, referential checks, duplicate/idempotency reconciliation, dry-run import, dual-read comparison and rollback rehearsals.
12. **Entitlements:** `authorizePaperOrder` currently gates trading on Firebase entitlement documents. PR #70 core schema does not yet demonstrate full entitlement/payment parity; define whether this remains Firebase-owned temporarily or is separately migrated.

## 6. Adapter architecture proposal (no runtime cutover)

Keep the current frontend contract stable. Introduce an internal backend port behind the existing gateway route handlers:

- `AuthPort`: verify Firebase token during transition; resolve Firebase UID ↔ Supabase UUID only through trusted mapping; later verify Supabase JWT.
- `PaperAccountRepository`: read/initialize shared account, positions, reservations and version.
- `PaperOrderRepository`: submit MARKET, submit/cancel/fill LIMIT, history and idempotent replay.
- `DerivativeRepository`: option execution, charges, positions and history.
- `WatchlistRepository`: read/update named watchlists.
- `BrokerConnectionRepository`: encrypted token envelope, OAuth state, generation and disconnect.
- `MarketDataPort`: existing Upstox provider/quote validation and persistent WebSocket/SSE runtime; independent of database adapter.
- Implement `FirebasePaperTradingAdapter` as the current production implementation and `SupabasePaperTradingAdapter` as isolated non-production implementation. Route selection must be explicit server-side configuration, default Firebase; no client-selectable backend flag.
- Add contract tests that run the same normalized request/response and accounting vectors against both adapters. Keep provider quote verification outside browser and before privileged DB RPC.

## 7. Rollback and data-loss prevention

1. Firebase remains authoritative during development and migration rehearsal.
2. Take a consistent Firestore export/snapshot and record export time, collection/document counts and checksums before every rehearsal.
3. Transform into staging-only datasets; never overwrite production data. Preserve source document IDs and Firebase UID as immutable legacy identifiers.
4. Reconcile account counts, cash, reservations, position quantities/cost basis, order status counts, realized P&L, watchlists, connection metadata and idempotency IDs/fingerprints.
5. Run read-only dual-read comparisons and shadow-write only to isolated staging; never dual-write production without an approved consistency protocol.
6. Cutover only after parity, load, auth, security, worker and rollback rehearsals plus explicit approval. Keep Firebase deployment and data intact during a defined rollback window.
7. Rollback means route traffic back to Firebase and freeze Supabase writes; reconcile any staging/canary writes before retry. Never replay a Supabase fill into Firebase blindly; deduplicate by preserved legacy order ID/fingerprint and audited migration ledger.
8. Maintain an append-only migration ledger with source collection/document ID, destination key, transform version, checksum, outcome and retry status.

## 8. Verification status

- Source files were fetched from the PR #28 integration head and the PR #70 design document was read.
- GitHub Actions run **44897469258** for commit `6aa3ac3f80da49712ed0bc10ed8d4c103bbeccdd`, workflow **Validate Indian Market Code**: completed, conclusion **success**.
- Its single job **Syntax and gateway unit tests** completed successfully. The actual CI step **Run unit and Firestore emulator integration tests** completed with conclusion **success**. Syntax checks, Firebase Functions checks, dependency audit gates, Docker build and non-root container check also completed successfully.
- Separate workflow run **44897469343** (Validate Mega Kirana Spark Backend) also completed successfully; it is outside this Paper Trading audit.
- These are existing CI results on the PR #28 baseline, not tests of this new audit branch, not Supabase parity tests, and not production/staging end-to-end verification.
- No new compatibility test has been claimed as passing in this audit commit.

## 9. Next work

1. Finish field-level review of all Firestore account/order/derivative/watchlist/lease/margin writers and response serializers.
2. Build a read-only legacy fixture exporter/normalizer and mapping validation tests using sanitized fixtures (no production data/secrets).
3. Add adapter interfaces and Firebase contract characterization tests in this isolated branch; do not change the production Firebase adapter behavior.
4. Compare each Supabase SQL RPC against Firebase golden vectors and test transaction concurrency, reservation races, RLS ownership, and identity mapping on a disposable staging database only after explicit approval.
5. Produce a final gap matrix and migration rehearsal checklist before any cutover proposal.

**Not authorized:** Firebase production changes, Supabase production SQL/data changes, PR #28 or PR #70 edits, live cutover, or production dual-write.
