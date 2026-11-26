# Firebase to Supabase transformation rehearsal

This is an offline-only transformation library. It has no Supabase/Firebase/network client and
cannot import, provision identities, create accounts, or mutate source records.

The caller must supply an explicit private mapping from each legacy Firebase UID to a
stable internal Supabase UUID. Missing mappings, duplicate UUID assignments and UIDs absent
from the exported Firebase Auth user list are rejected. The transformation emits
`paper_user_identity_map.jsonl` with `supabase_user_id` and `firebase_uid`; this file must be
imported before all rows with foreign keys. The identity map is sensitive and must stay in
the private output directory, never in the repository.

It maps indianPaperAccounts into one shared INR paper_accounts row, with Delivery and Intraday
equity positions separate, CE/PE derivative positions separate, and share reservations joined
to their source position. Equity and derivative orders preserve legacy 64-hex IDs and request
fingerprints; legacy idempotency_key remains NULL because Firebase did not persist its original
UUID. Intraday LIMIT orders are rejected. Derivative charges, quote metadata, cash delta and
realized P&L are preserved. Four named watchlists are transformed, with legacy instrumentKeys
mapped to My Stocks only when no named My Stocks list exists.

Run the dedicated unit test from market-gateway:
node --test test/firebase-to-supabase-transform.test.js

All four source collections (`indianPaperAccounts`, `indianPaperOrders`,
`indianDerivativeOrders`, `indianMarketWatchlists`) and the Firebase Auth user export must
be present in the manifest, even when a JSONL file is empty. Missing files or checksum/count
mismatches stop the transformation. The report includes an explicit dependency-safe import
order and `importAllowed: false` if any source record fails validation. It is a report only; no importer exists in this change.

Strict validation rejects missing UID mappings, duplicate identity UUIDs, orphaned Auth users,
malformed paise values, cash over-reservation,
inconsistent cost basis, unsupported product/order states, non-CE/PE derivatives and invalid
watchlists. No synthetic balance is generated. This library is not an importer and does not
perform Supabase writes. A later offline runner must verify source export checksums and write
only to a new private output directory.
