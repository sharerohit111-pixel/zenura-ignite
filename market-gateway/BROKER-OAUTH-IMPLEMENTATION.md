# Broker OAuth implementation contract

This stage adds the provider flow registry and an HMAC-authenticated, short-lived, user-bound OAuth state primitive. State is valid for ten minutes and is bound to both broker and authenticated user. The host must additionally persist a one-time nonce/consume record to prevent replay across callback requests; this helper alone does not provide one-time consumption.

## Provider flow distinctions
- Upstox: authorization-code flow. The existing gateway has an Upstox-specific token exchange and encrypted token storage.
- FYERS v3: authorization-code flow; refresh-token lifecycle is provider-specific. A 15-day refresh validity window is metadata, not a guarantee that refresh succeeds without a valid provider-issued token.
- Angel One SmartAPI: session authentication (client code, PIN/password and TOTP) rather than a generic browser OAuth callback. It must be implemented with a dedicated server-side session adapter and never by sending the user's TOTP or PIN through frontend logs.

## Required runtime wiring (not included in this contract module)
- Derive user ID exclusively from verified Supabase JWT.
- Create and persist a single-use state nonce with a unique constraint; callback must consume it atomically.
- Validate exact registered redirect URI; never accept callback URL from request input.
- Exchange code server-to-server with broker credentials stored in Secret Manager.
- Encrypt access/refresh tokens with AES-256-GCM and key versioning; do not store plaintext tokens.
- Store token expiry from provider response; do not infer a common SEBI expiry time.
- Add per-user connection ownership checks and audit events without logging codes/tokens.
- Add broker-specific rate limits and provider error redaction.
- No live stream until user token and provider-specific entitlement policy have passed.
- Do not use affiliate account-opening URLs as OAuth redirect URIs.

This is deliberately a small foundation stage. It does not claim to have completed live OAuth callbacks or connected broker sessions.
