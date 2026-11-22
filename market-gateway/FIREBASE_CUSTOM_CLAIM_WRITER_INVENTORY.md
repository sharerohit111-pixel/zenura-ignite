# Firebase custom-claim writer inventory (repository review)

## Scope and result

Reviewed the current ZENURA IGNITE repository integration snapshot and the relevant Firebase
authentication/server entry points for code that mutates Firebase Authentication custom claims
or automatically provisions the Supabase JWT role.

**Result: no in-repository custom-claim writer was identified in the files reviewed.**
In particular, the reviewed code does not call `setCustomUserClaims()`, and no Firebase Auth
blocking function or Auth user-create trigger was identified in the reviewed Cloud Functions
entry point.

This is a repository-only finding. It does **not** prove that no writer exists in Firebase
Console-managed extensions, Cloud Run/Functions deployed outside this repository, local
operator scripts, CI secrets/jobs, support tooling, another repository, or an external
identity provider. Those sources must still be inventoried with the project owner before
any custom-claim write.

## Files reviewed

| File | Relevant observation |
|---|---|
| `market-gateway/lib/firebase-auth.js` | Calls `auth.verifyIdToken(token, true)`; verifies signature/expiry/revocation and does not mutate claims |
| `market-gateway/server.js` | Initializes Firebase Admin Auth and delegates request authentication to the verifier; no custom-claim mutation found |
| `functions/index.js` | Initializes Firebase Admin and exports callable/HTTP functions; no Auth user-create/blocking trigger or custom-claim writer found |
| `crypto/firebase-auth.js` | Client-side email/password and Google sign-in/account creation; no Admin SDK or custom-claim write |
| `functions/package.json` | Firebase Admin SDK dependency exists; dependency presence alone is not evidence of a claim writer |
| `.github/workflows/deploy-firebase-functions.yml` | Deploy workflow reviewed; no claim provisioning step identified |

The active gateway verifier only checks the Firebase ID token and revocation status. It does
not inject `role: "authenticated"`; the Supabase adapter therefore remains intentionally
fail-closed until the role claim is provisioned through an approved mechanism.


## Firebase project-ID boundary discovered during review

The repository contains two different public Firebase Web App project IDs:

- Root `firebase-config.js`: `zenura-ignite-technologies`. The market-gateway production deployment guide also names `zenura-ignite-technologies` as the production project. This is the intended project for the Indian Paper Trading Firestore collections covered by this migration.
- `crypto/firebase-config.js`: `zenura-ignite`. This is a separate crypto-area client configuration and must not be silently treated as the source for the Indian Paper Trading migration.

The read-only role audit and Firestore export must use the explicitly confirmed project that owns
`indianPaperAccounts`, `indianPaperOrders`, `indianDerivativeOrders` and
`indianMarketWatchlists`. Repository configuration and deployment documentation point to
`zenura-ignite-technologies`, but before running against a live project the operator must
verify the Firebase Console project and the actual deployed gateway runtime project. Do not
run the audit against both projects or merge their user counts/data without a separate scope
decision. The other project may contain a separate app's users and must remain out of scope.

## Required external checks

Before any write, the project owner/operator must confirm:

- All Firebase projects/environments used by this app and the exact production project ID.
- Cloud Functions and Cloud Run services deployed in the project, including functions not
  represented by the current repository.
- Firebase Console extensions, Identity Platform blocking functions, Auth triggers and
  any scheduled jobs.
- Other repositories, local scripts, support/admin tools and CI workflows that can call
  Firebase Admin `setCustomUserClaims()`.
- Ownership of every existing custom claim and whether another system updates claims.

Do not infer a safe maintenance window from the repository review alone. All other claim
writers must be paused or otherwise coordinated before any bulk update because Firebase
Admin `setCustomUserClaims(uid, claims)` replaces the entire custom-claims object and has no
conditional compare-and-swap.

## Current safety boundary

- No Firebase users or custom claims were changed by this review.
- No Firebase audit or bulk provisioning was run.
- No Firebase Function was deployed or modified.
- No Supabase settings, schema, or production data were changed.
- This inventory is evidence for planning only, not authorization to write claims.
