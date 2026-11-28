# Smart token expiry and reconnect UX

## Product behavior

- Read expiry from the broker response whenever it is available; that authoritative timestamp overrides the local schedule.
- When a known provider has a documented daily expiry, calculate the next expiry in Asia/Kolkata time.
- At expiry, change the connection state to expired and show a one-tap reconnect action rather than a generic error.
- Attempt a refresh only where the provider's current API contract explicitly supports it and the user's refresh credential is valid. If refresh fails or is unavailable, fall back to the broker's official authorization/login flow.
- If no broker is connected, always keep **Continue in Demo / Replay Mode** available. Demo mode must not depend on broker credentials.
- Never display a token, refresh token, app secret, authorization code, or raw provider error to the user.

## Provider-specific schedule captured from current provider documentation

| Provider | Access-token handling | Refresh/reconnect |
|---|---|---|
| Upstox | Token expires at 03:30 AM IST the following day | Start broker authorization again when expired; do not assume refresh token support |
| FYERS | Access token expires daily at 06:30 AM IST | Refresh token is documented as valid for 15 days; use only the provider-supported refresh flow, then OAuth fallback |
| Angel One | Use provider-returned expiry/session status; do not invent a fixed clock | Follow the current SmartAPI session/auth contract |
| Kotak Neo | Use provider session response and API token configuration | TOTP + MPIN/session flow; no generic refresh assumption |

The code keeps provider schedules separate. For Angel One and Kotak Neo, an expiry timestamp from the provider is required; if it is unavailable the state is `expiry_unknown`, not a fabricated expiry.

## Important correction to the screenshot's wording

Do not encode “SEBI requires every broker token to expire between 03:30–07:30 AM” as a universal rule. The actual times differ by provider. The application must use each provider's published API contract and the expiry timestamp returned by that provider.

## References

- Upstox: https://upstox.com/developer/api-documentation/get-token/
- FYERS access token: https://fyers.in/api-docs/v3/api/authentication/individual-app/validate-auth-code/
- FYERS refresh token: https://support.fyers.in/portal/en/kb/articles/what-is-the-function-of-the-refresh-token-in-fyers
- Angel One: confirm against the current SmartAPI authentication documentation before enabling unattended refresh.
- Kotak Neo: https://github.com/Kotak-Neo/Kotak-Neo/blob/main/docs/authentication.md

## Scope

This is a provider-neutral policy helper and UX contract. It does not silently create broker sessions, persist tokens, schedule a refresh job, change OAuth callbacks, or enable real orders. Wire it into the broker connection UI only after the relevant provider adapter passes its own integration tests.
