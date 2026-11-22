# Firebase → Supabase Paper Trading identity adapter

This module is an isolated, server-side identity bridge. It does not replace Firebase
authentication, does not call Firebase Admin itself, and is not wired into the active
Firestore routes yet.

## Request flow

1. The adapter receives the original Express request and Firebase Admin Auth instance.
2. `resolveIdentity` extracts the strict Bearer token and itself calls the existing
   `authenticateFirebaseRequest(request, auth)`, which verifies that exact token with
   revocation checking enabled. This prevents pairing one verified decoded token with
   a different raw Bearer token.
3. The adapter validates UID = JWT sub, exact Firebase project audience and issuer,
   and the required `role: "authenticated"` custom claim.
4. It calls the PR #74 `public.current_paper_user_id()` RPC using only the Supabase
   publishable key plus the verified Firebase ID token. The private identity map is not
   queried directly or exposed to the browser.
5. It returns the mapped internal Supabase UUID. `buildPaperTradingRpcArgs` injects
   that UUID as `p_user_id` for an allowlisted user-scoped Trading RPC and rejects
   caller-supplied user IDs or unapproved function names.

## Required configuration

- `SUPABASE_URL`: HTTPS project origin.
- `SUPABASE_PUBLISHABLE_KEY`: publishable/legacy anon key; never a service-role key.
- `FIREBASE_PROJECT_ID`: exact Firebase project ID registered in Supabase Third-Party Auth.
- Firebase Third-Party Auth integration must be enabled for this exact Firebase project.
- Firebase JWTs must contain `role: "authenticated"`. Supabase documentation states
  Firebase tokens do not include this claim by default. Existing users need an approved,
  controlled custom-claim provisioning/refresh plan before this adapter can be activated.

## Security boundary

- Firebase Admin verification remains mandatory and must happen before adapter invocation.
- No client-supplied UID or Supabase UUID is trusted.
- The identity lookup uses the authenticated Firebase JWT, not a service-role key.
- No service-role key is included, returned, or stored by this module.
- RPC argument builder accepts only the five user-scoped Paper Trading RPCs from PR #74
  and always injects the server-resolved UUID. A separate server-only Supabase RPC
  transport must use a secret/service key held only in Cloud Run Secret Manager.
- Do not pass this resolved identity to browser code or log JWTs, keys, Firebase UIDs,
  or identity-map values.
- The module is not connected to live routes. Existing Firestore reads/writes continue
  unchanged until a separately reviewed adapter rollout and explicit cutover approval.

## Verification status

Synthetic tests cover claim validation, project isolation, identity lookup, missing map,
network/API errors, UUID validation, forged identities, RPC allowlisting and user-ID
override attempts. No Firebase custom claims were modified, no real token was requested,
and no Supabase query was sent during development.
