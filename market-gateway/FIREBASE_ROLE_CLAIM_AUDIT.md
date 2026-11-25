# Firebase role claim coverage audit

This audit reads Firebase Authentication user records using the Admin SDK and reports aggregate counts only. It never writes custom claims, exports user identifiers, emails, tokens, or arbitrary claim values, or changes the active Firebase backend.

## Dry run

From market-gateway/:

    node scripts/firebase-role-claim-audit.js

The default dry run performs no Firebase reads.

## Explicit read-only audit

Use Application Default Credentials with permission to list Firebase Auth users. Select the exact source project and a new private output directory:

    export FIREBASE_PROJECT_ID="your-explicit-firebase-project-id"
    node scripts/firebase-role-claim-audit.js --confirm-read-only-audit --out-dir ./private-role-audit

The audit paginates Firebase Auth users and inspects only whether customClaims.role is exactly authenticated, missing, or another value. It writes aggregate counts only to role-claim-audit.json in an owner-only directory/file. No UID, email, phone, display name, or claim value is recorded. Disabled/enabled account counts are included separately.

## Interpretation

- roleAuthenticated: user records whose custom claim is exactly role authenticated.
- roleMissing: no role custom claim exists.
- roleUnexpected: a role claim exists but has a different value.
- This is an inventory, not a provisioning tool. It does not add, remove, or modify claims.

Supabase Firebase Third-Party Auth requires a JWT role claim suitable for PostgREST (authenticated). Existing Firebase ID tokens may need to be refreshed after any separately approved custom-claim rollout. Do not activate the Supabase adapter until the claim strategy and session refresh behavior have been reviewed and tested.

## Safety and tests

The command requires --confirm-read-only-audit, an explicit project ID, and a new output directory. It uses Firebase Admin listUsers only. Synthetic tests use fake paginated Auth responses and no production credentials.

Run:

    node --test test/firebase-role-claim-audit.test.js

No Supabase request, Firebase custom-claim mutation, deployment, export, or data migration is part of this audit.

## Project selection warning

The repository has two Firebase Web App configurations. The root configuration and the Indian Market Gateway production deployment guide identify `zenura-ignite-technologies` as the intended Indian Paper Trading backend project. `crypto/firebase-config.js` identifies a separate project, `zenura-ignite`. Do not run this audit against the crypto project by mistake. Before executing, verify in Firebase Console and against the deployed gateway runtime that the explicitly selected project owns the Indian Paper Trading collections. The audit never guesses a project from ambient environment variables.
