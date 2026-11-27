# Firebase → Supabase identity migration boundary

Status: implementation helper and unit tests only. No Firebase user is provisioned,
no Auth record is created, no account is initialized, and no existing Firebase user
or Firestore document is modified by this change.

## Runtime contract

1. The existing gateway must continue to verify the Firebase ID token, including
   revocation checking, before calling the identity resolver.
2. Pass only the verified token's `uid` to
   `market-gateway/lib/supabase-identity.js`.
3. The resolver reads the private `paper_user_identity_map` table using a
   server-only Supabase admin client. The service-role key must never be sent to
   a browser or logged.
4. A mapped UUID is returned only when the mapping exists and is syntactically valid.
5. An unmigrated Firebase UID returns HTTP 409 with
   `SUPABASE_IDENTITY_NOT_MIGRATED`; callers must not fall back to a new-account
   initializer or silently grant the default ₹10,00,000.
6. Database errors and malformed mappings fail closed with a generic 503 response.

## Provisioning is intentionally separate

The resolver does not create `auth.users` rows or insert identity mappings. A later
provisioning job must first select and approve the Supabase Auth identity strategy,
create the Auth identity with a stable UUID, insert the Firebase UID mapping, and then
import the existing paper-account state and history in a transactionally reconciled
batch. It must preserve balances, positions, reservations, P&L, order IDs, idempotency
fingerprints, watchlists, encrypted Upstox token envelopes, and connection-generation
state. New-user initialization must never run for an imported legacy account.

## Cutover gate

Do not route production traffic to Supabase until:
- every eligible Firebase UID has exactly one mapping;
- every mapping references a real Supabase Auth identity;
- account and order import counts/checksums reconcile;
- Firebase-vs-Supabase portfolio and order replay tests pass;
- the staging gateway passes Auth, RLS, trading, OAuth, stream-lease, worker,
  concurrency, rollback, and load tests; and
- a separate production cutover is explicitly approved.

The existing Firebase backend remains the source of truth until those gates pass.
