# Firebase read-only export rehearsal

This tool prepares a local snapshot of the existing Paper Trading data. It is export-only:
it does not import to Supabase, update Firestore, change Firebase configuration, deploy
functions, or switch application traffic.

## Inspected source collections

- customerProfiles/{firebaseUid} and users/{firebaseUid}: deliberately NOT exported. The Paper Trading transformer does not consume these profile/entitlement documents; excluding them avoids copying email, phone, display name and unrelated profile data.
- indianPaperAccounts/{firebaseUid}: one shared INR balance, reserved cash, Delivery,
  Intraday and derivative position maps, realized P&L, version and timestamps.
- indianPaperOrders/{sha256-order-id}: equity MARKET and Delivery LIMIT order history.
- indianDerivativeOrders/{sha256-order-id}: long CE/PE option history, charges and quote data.
- indianMarketWatchlists/{firebaseUid}: named per-user watchlists.
- Firebase Auth users are exported separately as UID-only records. The transformer uses these UIDs solely to validate that Firestore references have matching Auth identities; contact details, provider identities and sign-in metadata are not exported.

The allowlist contains only the four Trading data collections. Firebase Auth users are exported separately as UID-only records for orphan-reference validation; no email, phone, display name, provider identity or sign-in metadata is exported. `customerProfiles` and `users` are explicitly recorded in the manifest as not required and are not read.

The exclusion list also excludes upstoxConnections because it contains encrypted broker-token
envelopes. OAuth state, connection-control, stream lease, worker cursor, margin-preview
rate-limit and payment-provider collections are also excluded. Password hashes, salts,
MFA secrets and refresh tokens are never exported.

## Run

From market-gateway/ with Node.js 22 and the repository's firebase-admin dependency:

    node scripts/firebase-readonly-export.js

This is a dry run and performs no Firebase reads. To create a local snapshot, explicitly
select the source project and a new output directory:

    export FIREBASE_PROJECT_ID="zenura-ignite-technologies"
    node scripts/firebase-readonly-export.js --confirm-read-only-export --out-dir ./private-export

The exporter accepts only the explicit `FIREBASE_PROJECT_ID` variable. It deliberately ignores ambient `GOOGLE_CLOUD_PROJECT` and `GCLOUD_PROJECT` values so a shell or CI default cannot silently select a different Firebase project. The current repository root Firebase configuration and Indian Market Gateway production guide identify `zenura-ignite-technologies` as the intended Indian Paper Trading project; verify the Firebase Console project and deployed gateway runtime before running. The separate `crypto/firebase-config.js` points to `zenura-ignite` and is out of scope.

Authenticate with Application Default Credentials that have read-only access. The output
directory must not already exist. JSONL files are written in document-name order with
counts and SHA-256 digests in manifest.json. Firestore timestamps, byte arrays, references
and dates carry type markers. Files use owner-only permissions where supported.

Do not commit exports, upload them to GitHub, paste their contents into chat, or store them
in a public folder. Treat output as sensitive personal/financial data. Do not run against
production until the operator has selected the source project and explicitly approved the
read-only export itself.

## Migration constraints

- Firebase UIDs are strings; only UIDs referenced by the four Trading collections are mapped to Supabase UUIDs using the private identity map.
  Never cast Firebase UIDs to UUIDs or create new virtual accounts during import.
- One indianPaperAccounts document is one shared cash account across Delivery, Intraday
  and supported long CE/PE options. Never split it into separate ₹10 lakh accounts.
- Equity position maps are positions (Delivery), intradayPositions, reservedPositions and
  intradayReservedPositions; options are in derivativePositions.
- Legacy order IDs are deterministic SHA-256 strings; original UUID idempotency keys are
  not persisted in legacy order documents. Preserve the old order ID and request fingerprint.
- The exporter does not recurse into arbitrary subcollections. Any subcollection discovered
  must be inventoried and added explicitly before a separately approved export.
- This is not a transactionally consistent cutover snapshot. A future rehearsal must use
  a write-quiescence window or a documented watermark/dual-read strategy.
- No transformation or Supabase import is included in this task.

## Tests

Run npm test from market-gateway/. The dedicated workflow runs exporter syntax and unit
tests without Firebase credentials or production access.
