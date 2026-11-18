# ZENURA IGNITE — Indian Market Gateway (Cloud Run)

This service is a separate long-lived gateway for Upstox Market Data Feed V3. It is not deployed by Firebase Functions.

## Environment
- `UPSTOX_TOKEN_ENCRYPTION_KEY`: same base64-encoded 32-byte key used by Firebase Functions.
- `MAX_INSTRUMENT_KEYS`: per-browser-session guardrail (default 100; must remain within provider limits).
- Cloud Run service account must have Firestore read access to `upstoxConnections` only as required.

## Deploy
Build and deploy this directory as a Cloud Run service. Set ingress/auth policy to allow the public HTTPS endpoint because Firebase ID token validation is performed in the service. Never disable application authentication. Set `UPSTOX_TOKEN_ENCRYPTION_KEY` from Secret Manager, not source control.

## API
- `GET /health`: service health.
- `POST /stream`: Authorization: Bearer <Firebase ID token>; JSON body `{"instrumentKeys":["NSE_INDEX|Nifty 50"],"mode":"ltpc"}`; responds with Server-Sent Events containing decoded V3 protobuf messages.

The gateway obtains the encrypted token for the authenticated Firebase UID, decrypts it in memory, requests the V3 authorized WebSocket URL, subscribes only to requested keys, and streams decoded events to that authenticated client. No Upstox access token is sent to the browser.

## Important limits and operations
The default 100-key per-session guardrail is intentionally conservative and is not a substitute for provider-account-wide subscription accounting. Implement a shared per-user connection/subscription coordinator before production scale-out: Upstox documents limits across all connections for the user. Cloud Run instance scaling can otherwise exceed those limits. Configure concurrency/max instances and monitor active streams. Add heartbeat/reconnect/backoff, token refresh/reconnect, instrument-master ingestion, rate limiting, and entitlement policy before public production use.

The official V3 feed uses binary protobuf messages; see Upstox's `MarketDataFeedV3.proto`. This service uses that upstream schema.
