# Broker OAuth implementation contract

This stage now includes the server-side provider wiring for FYERS v3 and Angel One SmartAPI, alongside the existing Upstox flow. It is still a draft integration: live market-data entitlements, broker order placement, hosted migration execution and production deployment are not enabled by this PR.

## Provider flow distinctions
- Upstox: existing authorization-code flow and Upstox-specific token exchange/storage remain isolated.
- FYERS v3: authorization-code flow. OAuth state is broker-bound, short-lived and atomically consumed once. The callback exchanges the code server-to-server and stores only an AES-256-GCM token envelope. Daily reauthentication is required; this adapter does not assume refresh-token continuity.
- Angel One SmartAPI: dedicated authenticated session flow using Client ID, PIN and current TOTP. PIN/TOTP are cleared from parsed request data and local credential references; the encrypted JWT/refresh/feed token bundle is stored server-side. No TOTP generation or storage is implemented.

## Security boundaries
- User identity for start/status/disconnect comes only from verified Supabase JWT; callback ownership comes only from the consumed server-side state record.
- Redirect URI is configured server-side and must be a clean HTTPS callback endpoint.
- OAuth state is stored as a SHA-256 hash and consumed atomically with broker binding and expiry checks.
- Broker tokens are encrypted with AES-256-GCM and stored in the server-only `broker_connections` table. Browser roles receive no table privileges; RLS is enabled and forced.
- FYERS status and disconnect operations filter by both authenticated user ID and broker name.
- Angel One login attempts are throttled per user in PostgreSQL; provider errors are redacted from responses.
- No affiliate account-opening URLs are used as OAuth redirect URIs.
- No live market-data stream or order placement is enabled by this integration.

## Required runtime configuration
See `market-gateway/FYERS-OAUTH-SETUP.md` and `market-gateway/ANGEL-ONE-SMARTAPI-SETUP.md`. Keep credentials in server-side deployment secrets only. Do not place broker secrets in the static frontend.

## Validation and release status
- Deterministic Node tests cover state primitives, provider response validation, token expiry, connection ownership filters and credential scrubbing.
- The disposable PostgreSQL migration workflow now checks broker table grants, forced RLS, OAuth broker binding, expiry and one-time state consumption.
- Exact-head CI and migration smoke must pass before this work is considered ready.
- Keep PR #328 Draft and unmerged. Do not run hosted migrations, create live broker sessions, place real orders, deploy to production or modify the Crypto folder.
