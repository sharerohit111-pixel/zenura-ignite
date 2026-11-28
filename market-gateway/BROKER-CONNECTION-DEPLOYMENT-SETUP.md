# Broker connection deployment configuration (Cloud Run)

This guide prepares FYERS v3 OAuth and Angel One SmartAPI session configuration for a future, separately approved gateway deployment. It does not enable a broker connection, create credentials, run migrations, or deploy anything.

## Safety boundary

- Keep PR #328 Draft and unmerged.
- Do not add provider credentials to Git, GitHub Pages, frontend environment files, build arguments, or browser storage.
- Do not deploy from a PR branch. The current gateway deployment workflow is restricted to `main` and requires manual dispatch.
- Keep broker session/order functionality separate from market-data rights approval. A successful account connection does not grant market-data redistribution rights or authorize real orders.
- Demo / Replay must remain usable without either broker being configured.

## Existing gateway environment names

The gateway reads the following server-only variables:

| Provider | Runtime variable | Secret Manager recommendation |
|---|---|---|
| FYERS | `FYERS_CLIENT_ID` | `zenura-fyers-client-id` |
| FYERS | `FYERS_CLIENT_SECRET` | `zenura-fyers-client-secret` |
| FYERS | `FYERS_REDIRECT_URI` | Non-secret Cloud Run env var; exact registered HTTPS callback |
| Both | `BROKER_TOKEN_ENCRYPTION_KEY` | Optional dedicated 32-byte AES-256-GCM key |
| Angel One | `ANGEL_ONE_SMARTAPI_KEY` | `zenura-angel-one-smartapi-key` |
| Angel One | `ANGEL_ONE_CLIENT_LOCAL_IP` | Non-secret Cloud Run env var; actual configured local IPv4 |
| Angel One | `ANGEL_ONE_CLIENT_PUBLIC_IP` | Non-secret Cloud Run env var; actual gateway egress IPv4 |
| Angel One | `ANGEL_ONE_MAC_ADDRESS` | Non-secret Cloud Run env var; value accepted by SmartAPI |
| Angel One | `ANGEL_ONE_SOURCE_ID` | Non-secret Cloud Run env var: `WEB` or `MOBILE` |

The gateway currently falls back from `BROKER_TOKEN_ENCRYPTION_KEY` to the existing `UPSTOX_TOKEN_ENCRYPTION_KEY`. Prefer a dedicated key for broker credentials in a future key-rotation plan; do not rotate an existing key without a tested re-encryption/migration procedure.

## FYERS callback requirements

1. Register the exact HTTPS URL `https://<gateway-host>/fyers/oauth/callback` in the FYERS developer application.
2. Set `FYERS_REDIRECT_URI` to that exact value, including path and trailing-slash behaviour.
3. Store client ID and client secret only in Secret Manager.
4. Configure the FYERS application permissions and account access directly with FYERS.
5. The current implementation uses a short-lived, broker-bound, one-time OAuth state and stores the access token encrypted server-side. FYERS tokens expire daily at 06:30 IST; the user must complete the broker's daily authentication process as required.

## Angel One network requirements

1. Create/configure the SmartAPI application and obtain its API key.
2. Determine the actual Cloud Run egress/network identity required by Angel One. Do not guess the public IP, local IP, or MAC address and do not use loopback placeholders.
3. Configure the required values only after confirming them against Angel One's current SmartAPI requirements and the deployed network architecture.
4. Set source ID to `WEB` or `MOBILE` as appropriate.
5. The route intentionally returns configuration unavailable when required values are missing or invalid. PIN and TOTP are supplied per login and must never be stored as deployment secrets.

## Deployment gate checklist (not an instruction to deploy)

Before a future production deployment is separately authorized, an operator must verify:

- All required Secret Manager entries exist and the Cloud Run service identity has access only to the needed secrets.
- The FYERS redirect URI exactly matches the URI registered at FYERS.
- Angel One IP/MAC/source headers are verified from the actual production egress architecture.
- Encryption key format and backup/rotation procedure are verified.
- Gateway origin, CORS allowlist, Supabase auth, and RLS smoke tests pass.
- Provider account-connection tests are performed only with explicit user consent in a controlled test account.
- No real order placement, live market-data activation, hosted migrations, or Crypto-folder changes are included in this PR.

No deployment workflow change is made by this guide. The existing deployment workflow currently wires Upstox secrets only; a separate reviewed change is required before FYERS or Angel One can be enabled in Cloud Run.
