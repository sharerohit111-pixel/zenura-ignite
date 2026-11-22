# Supabase server-side REST adapter

Status: isolated client utility and unit tests only. It is not wired into the existing
Paper Trading gateway and has not been given production credentials.

## Security contract

- The adapter is for the trusted Node.js gateway only.
- It requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from server-side secret storage.
- It uses the service-role key only in server-side Authorization and apikey headers.
- Never send this client or its key to a browser, mobile app, log, or analytics event.
- Authenticate each incoming request with the existing Firebase Admin ID-token verifier
  (including revocation checking) before resolving the Firebase UID.
- Resolve the verified Firebase UID through paper_user_identity_map. An unmigrated UID
  fails closed with HTTP 409; it must not be passed to the new-account initializer.
- Call trading RPCs only with trusted server-derived instrument and fresh provider quote
  data. Never trust client-supplied prices, contract metadata, user UUIDs, or service keys.
- RPC/database error bodies are deliberately not returned to clients.

## Runtime environment

Set these only in the server runtime after the schema and identity map are ready:

- SUPABASE_URL: the existing project URL.
- SUPABASE_SERVICE_ROLE_KEY: server-only secret; never a publishable key.

No values are added to source control. This utility does not deploy a service, change the
Cloud Run service, or redirect any production route.
