# Firebase `role: authenticated` rollout plan (approval-gated)

## Status

Planning only. This document does not change Firebase users, custom claims, Cloud Functions,
Firebase project settings, Supabase settings, application routes, or user sessions. The
read-only role-claim audit must be run and reviewed before any provisioning proposal.

## Why this is required

Supabase Third-Party Firebase Auth expects the JWT to carry the literal
`role: "authenticated"` claim for requests to run as the Postgres authenticated role.
Firebase ID tokens do not include that claim by default. The current Paper Trading identity
adapter deliberately rejects tokens without it. See the official Supabase Firebase Auth
guide: https://supabase.com/docs/guides/auth/third-party/firebase-auth

## Critical Admin SDK behavior

Firebase Admin `setCustomUserClaims(uid, claims)` replaces the user's complete custom-claims
object; it is not a patch operation. A naive call with only `{ role: "authenticated" }`
can erase unrelated custom claims. Firebase documents this overwrite behavior:
https://firebase.google.com/docs/auth/admin/custom-claims

Any future additive provisioning must:
1. Read the current user record from Firebase Admin.
2. Build a new object by preserving every existing custom claim and adding/replacing only
   `role: "authenticated"`.
3. Check the resulting serialized claim payload against Firebase's 1000-byte limit.
4. Re-read and compare the current claim object immediately before writing; abort on drift.
5. Serialize writes per UID and rate-limit batches; do not run overlapping claim writers.
6. Record aggregate success/failure counts only in ordinary logs. Never log UIDs, emails,
   tokens, or claim values.
7. Treat a failed/ambiguous write as unresolved and re-read before retrying.

Because the API has no conditional compare-and-swap, a concurrent writer can still race
between the re-read and write. Therefore claim provisioning must be performed in a
controlled maintenance window with all other custom-claim writers paused. If that cannot
be guaranteed, do not use a bulk Admin SDK rollout.

## Required gates before any write

- [ ] Run the existing read-only audit against the explicitly selected Firebase project.
- [ ] Review aggregate enabled/disabled, authenticated/missing/unexpected counts.
- [ ] Inventory every existing custom-claim writer (Cloud Functions, Admin scripts, support
  tools, scheduled jobs) and determine who owns each claim.
- [ ] Confirm whether the project uses Firebase Authentication with Identity Platform.
  Blocking before-create/before-sign-in functions are an alternative; they must be reviewed
  for compatibility and do not replace the existing-user migration.
- [ ] Agree on a private, encrypted, access-controlled rollback record of each user's
  pre-change custom-claims object. Never store this backup in GitHub, this repository,
  ordinary CI artifacts, or chat. If secure rollback storage is unavailable, do not write.
- [ ] Test preservation, byte-limit handling, failure recovery, and rollback using a
  disposable Firebase project with synthetic users and unrelated claims.
- [ ] Approve a small canary cohort and a measured batch/stop policy.
- [ ] Confirm the exact Firebase project ID and obtain explicit approval for the write
  operation separately from approval to run the read-only audit.

## New-user and session behavior

For future users, select one reviewed mechanism:
- If Identity Platform is enabled, evaluate blocking before-user-created and
  before-user-signed-in functions. Supabase documents these as synchronous claim injection.
- Otherwise, an Auth onCreate trigger is asynchronous. The client must force-refresh its
  Firebase ID token after the trigger has completed; the first token can lack the role.

For existing users, a changed custom claim appears in newly issued ID tokens. Clients may
need a forced refresh (Firebase client `getIdToken(true)`) or a fresh sign-in. Do not
globally sign users out or revoke refresh tokens as a shortcut. Test token refresh and
failure UX on a canary account first.

References:
- Supabase Firebase Auth: https://supabase.com/docs/guides/auth/third-party/firebase-auth
- Firebase custom claims: https://firebase.google.com/docs/auth/admin/custom-claims
- Firebase Admin Node API: https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth

## Rollback

- Stop the rollout immediately on unexpected claim changes, elevated failures, or
  authentication regressions.
- Restore the exact pre-change claims object from the encrypted rollback record using the
  same controlled, serialized writer.
- Re-read affected accounts and verify restoration counts before resuming Firebase-only
  operation.
- Keep the Supabase adapter disconnected until rollback or forward-fix is verified.
- Never delete all custom claims as a rollback shortcut.

## Current project boundary

The current implementation remains read-only/inert:
- No Firebase role audit has been run against the real project.
- No custom claims have been changed.
- No Cloud Function has been deployed or modified.
- Supabase Third-Party Auth has not been enabled by this work.
- The identity adapter is not wired into active Firestore routes.
- No export, import, schema deployment, or production cutover has occurred.

This plan is not authorization to perform any of those actions.
