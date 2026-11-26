# Firebase Paper Trading data dependency inventory

## Purpose and scope

This is a static repository-code inventory for the Indian Paper Trading Firebase-to-Supabase migration. It does not query Firestore, Firebase Auth, production logs, or deployed services. Findings are limited to the files listed below and must not be read as proof that no external writer, extension, separate repository, or undocumented subcollection exists.

## Paper Trading source data in scope

| Collection | Observed code use | Document ownership / migration treatment |
|---|---|---|
| `indianPaperAccounts/{firebaseUid}` | `market-gateway/server.js` account read/initialization and order transaction paths; helper modules normalize and mutate account state | One shared INR paper account per Firebase UID. Preserve one account across Delivery, Intraday and supported CE/PE derivative positions; do not create separate mode balances. |
| `indianPaperOrders/{sha256-order-id}` | `market-gateway/server.js` order placement, idempotent replay, LIMIT cancellation and cursor-based order history | Preserve legacy 64-character SHA-256 document ID, stored UID ownership, request fingerprint and order history. |
| `indianDerivativeOrders/{sha256-order-id}` | `market-gateway/server.js` derivative placement and derivative order history | Preserve legacy 64-character SHA-256 document ID, UID ownership, CE/PE contract details, charges and execution/accounting fields. |
| `indianMarketWatchlists/{firebaseUid}` | `market-gateway/server.js` watchlist read and named-list normalization | One per-user document with named watchlists. Keep instrument keys; market instrument master is refreshed separately and is not user portfolio data. |

The four collections above are the exporter allowlist. The transformer also consumes the UID-only Firebase Auth export to validate that referenced Firebase UIDs exist; it does not need Auth contact/profile fields.

## Profile and entitlement data deliberately outside this export

- `customerProfiles/{firebaseUid}` and `users/{firebaseUid}` are not consumed by the four Trading data transformations in `firebase-to-supabase-transform.js`; they are excluded to avoid copying profile PII or unrelated account metadata.
- `entitlements` appears in `functions/index.js` payment/entitlement logic. It is an application access/subscription concern, not a Paper Trading balance, position, order or watchlist record. Review and migrate it separately only if a later product-access migration requires it.
- Firebase Auth export is restricted to `{ uid }` records for orphan-reference validation.

## Related operational collections — excluded

Static references in the reviewed gateway / Functions files include:
- `upstoxConnections`: broker connection/token envelope consumed by market gateway for broker-backed quotes and order validation. It contains sensitive encrypted broker credentials and must not be copied into the Paper Trading data snapshot.
- `upstoxOAuthStates` and `upstoxConnectionControls`: OAuth and broker connection control state.
- `paymentOrders`, `razorpayEvents`: payment processing state.
- `indianMarketStreamLeases`, `indianMarketWorkerState`: stream/worker coordination state.
- `indianMarginPreviewLimits`: rate-limit/operational state.

These collections remain excluded from the exporter. Exclusion does not mean the live application does not use them; it means they belong to separate operational/security migrations, if any.

## Reviewed files

- `market-gateway/server.js`
- `market-gateway/lib/paper-account-state.js`
- `market-gateway/lib/paper-order-transaction.js`
- `market-gateway/lib/derivative-order-transaction.js`
- `market-gateway/lib/watchlists.js`
- `market-gateway/scripts/firebase-readonly-export.js`
- `market-gateway/scripts/firebase-to-supabase-transform.js`
- `functions/indian-market.js`
- `functions/index.js`

The literal Firestore collection scan found the four Trading collections and the listed broker/payment/entitlement operational collections in the reviewed gateway/Functions entry points. Helper modules primarily receive references or state from the caller rather than constructing collection names themselves.

## Subcollections and dynamic paths

The exporter reads only top-level named collections and does not recurse into subcollections. The reviewed files did not reveal a `collectionGroup` or `listCollections` enumeration for the four Trading collections. This is a bounded static scan, not a live Firestore inventory. Before any production export, subcollections must be separately inventoried in the confirmed Firebase project using authorized read-only access, and any discovered dependencies must be reviewed and explicitly allowlisted.

## Migration invariants and open gates

1. Map Firebase UID strings to stable internal Supabase UUIDs through the private identity map; never cast UIDs to UUIDs.
2. Keep one shared cash account per user across supported Paper Trading modes.
3. Keep broker credentials, OAuth state, payment internals and worker/lease state outside this migration.
4. The snapshot is not transactionally consistent; cutover requires write quiescence or an explicit watermark/dual-read plan.
5. No live Firebase reads/export, Supabase import, schema deployment, auth claim changes or production cutover are performed by this inventory.
6. Before a live audit/export, the operator must explicitly confirm the actual Indian Paper Trading Firebase project and use authorized read-only credentials. Repository configuration alone is not sufficient confirmation.
