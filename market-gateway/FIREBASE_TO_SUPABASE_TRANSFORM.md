# Firebase to Supabase transformation rehearsal

This is an offline-only transformation library. It has no Supabase/Firebase/network client and
cannot import, provision identities, create accounts, or mutate source records.

The caller must supply an explicit private mapping from each legacy Firebase UID to an
already-provisioned Supabase Auth UUID. Missing mappings are hard errors; UIDs are never
cast or guessed. Keep the mapping outside the repository.

It maps indianPaperAccounts into one shared INR paper_accounts row, with Delivery and Intraday
equity positions separate, CE/PE derivative positions separate, and share reservations joined
to their source position. Equity and derivative orders preserve legacy 64-hex IDs and request
fingerprints; legacy idempotency_key remains NULL because Firebase did not persist its original
UUID. Intraday LIMIT orders are rejected. Derivative charges, quote metadata, cash delta and
realized P&L are preserved. Four named watchlists are transformed, with legacy instrumentKeys
mapped to My Stocks only when no named My Stocks list exists.

Run the dedicated unit test from market-gateway:
node --test test/firebase-to-supabase-transform.test.js

Strict validation rejects missing UID mappings, malformed paise values, cash over-reservation,
inconsistent cost basis, unsupported product/order states, non-CE/PE derivatives and invalid
watchlists. No synthetic balance is generated. This library is not an importer and does not
perform Supabase writes. A later offline runner must verify source export checksums and write
only to a new private output directory.
