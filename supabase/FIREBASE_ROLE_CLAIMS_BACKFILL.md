# Firebase role-claim backfill for Supabase third-party Auth

Status: **prepared utility only — not executed**.

The existing Firebase project ID is zenura-ignite-technologies. Supabase's hosted
Firebase third-party Auth integration requires Firebase JWTs to contain the
role: authenticated claim so the Data API assigns the PostgreSQL authenticated role.

## Safety behavior

- Dry-run is the default; it scans users and prints aggregate counts only.
- Writes require both --apply and SUPABASE_FIREBASE_TPA_READY=true.
- Writes also require --confirm-project=zenura-ignite-technologies.
- Only users without an existing role claim are updated.
- Existing role: authenticated users are skipped.
- Any other existing role value is reported as a conflict and is never overwritten.
- All unrelated custom claims are preserved.
- User identifiers, emails, phone numbers and claim contents are never printed.
- The script is paginated, idempotent, and stops on a Firebase Admin API error.

## Run only after the Supabase Third-Party Auth integration is enabled

Use an operator environment with Firebase Admin Application Default Credentials
restricted to the zenura-ignite-technologies project.

Dry-run:

    FIREBASE_PROJECT_ID=zenura-ignite-technologies node functions/backfill-supabase-role-claims.js

Apply (do not run until the Supabase Firebase provider is enabled and the staging
configuration has been verified):

    FIREBASE_PROJECT_ID=zenura-ignite-technologies SUPABASE_FIREBASE_TPA_READY=true node functions/backfill-supabase-role-claims.js --apply --confirm-project=zenura-ignite-technologies

After claims are updated, users need a refreshed Firebase ID token before the role
claim appears in requests. This utility does not deploy functions, change Firebase
login behavior, enable the Supabase provider, or migrate user data.

## Not included

This one-time utility does not install a sign-up trigger for future users. Before
client-side Supabase access is enabled, a separate additive Firebase Auth trigger
must ensure newly created users receive the same role claim. That trigger must preserve
existing claims and be tested/emulated before deployment.
