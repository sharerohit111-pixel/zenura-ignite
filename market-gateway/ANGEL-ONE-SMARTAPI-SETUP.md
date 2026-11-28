# Angel One SmartAPI session configuration

Angel One uses its SmartAPI password-login endpoint, not OAuth. The user supplies Client ID, trading PIN and the current six-digit TOTP in the in-app form. The browser sends these once over HTTPS to the authenticated gateway. PIN and TOTP are cleared in the browser after submission and in the gateway request object immediately after the provider request; they are never written to the broker_connections table or application logs.

## Required server-side configuration

- `ANGEL_ONE_SMARTAPI_KEY`: SmartAPI application API key. Server secret only; never expose it in the static frontend.
- `BROKER_TOKEN_ENCRYPTION_KEY`: recommended dedicated base64-encoded 32-byte AES-256-GCM key. If omitted, the gateway falls back to the existing `UPSTOX_TOKEN_ENCRYPTION_KEY`.
- `ANGEL_ONE_CLIENT_LOCAL_IP`: valid local IPv4 address required by SmartAPI headers.
- `ANGEL_ONE_CLIENT_PUBLIC_IP`: actual public egress IPv4 address of the gateway.
- `ANGEL_ONE_MAC_ADDRESS`: MAC address value required by SmartAPI request headers.
- `ANGEL_ONE_SOURCE_ID`: `WEB` or `MOBILE`.

The gateway deliberately returns configuration unavailable until all required header values are explicitly configured; it does not send placeholder loopback IP/MAC values.

## Security and behaviour

- The login endpoint is rate-limited per authenticated user (five attempts per 15 minutes and at least one second between attempts, enforced by a shared Supabase database limiter across gateway instances).
- Only the JWT, refresh token and feed token bundle is AES-256-GCM encrypted and persisted in the server-only `broker_connections` row.
- The session expiry is recorded at 05:00 IST on the subsequent calendar day, consistent with Angel One SmartAPI's published session guidance; sessions can be invalidated earlier by logout or account credential changes. No automatic refresh is enabled in this initial adapter.
- Disconnect clears this user's Angel One encrypted session first, then attempts the provider logout endpoint. The response distinguishes confirmed from unconfirmed provider logout.
- This integration is for account connection/session only. It does not submit real broker orders.
- Demo / Replay remains independent and requires no Angel One credentials.

Before enabling the route for real users, configure and verify the SmartAPI application and network header values in the server deployment. Do not put these values in GitHub Pages or a frontend `.env`.
