## FYERS OAuth runtime configuration

The FYERS adapter is optional and does not change the existing Upstox configuration. Configure these server-side secrets in the market-gateway deployment and register the exact callback URL in the FYERS developer dashboard:

- `FYERS_CLIENT_ID`: FYERS API app ID.
- `FYERS_CLIENT_SECRET`: FYERS app secret; never expose it to the browser.
- `FYERS_REDIRECT_URI`: exact HTTPS callback URL ending in `/fyers/oauth/callback`.
- `BROKER_TOKEN_ENCRYPTION_KEY`: optional dedicated base64-encoded 32-byte AES-256-GCM key. If omitted, the existing server-side Upstox encryption key is reused; a dedicated key is recommended.

The callback consumes the broker-bound, one-time state before exchanging the authorization code. It stores only an AES-256-GCM envelope in `broker_connections`. FYERS documents that access tokens expire daily at 06:30 IST; the adapter records the next 06:30 IST boundary and does not assume refresh-token support. No broker order placement is added by this change.

The authenticated frontend obtains the authorization URL from `POST /fyers/oauth/start` and navigates the user to it. The callback redirects to the configured app URL with `?fyers=connected` or `?fyers=error`.
