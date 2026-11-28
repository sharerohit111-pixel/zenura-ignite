# Redis Runtime Integration Plan — S-TRADE

## Decision

Do not add a Redis client dependency or start Redis from `supabase-server.js` in this change. The current gateway's production stream path is a per-user Upstox WebSocket-to-SSE route. The staged central-feed publisher, authenticated fan-out and subscriber are injected adapters only. There is no existing Redis runtime client or Redis deployment contract in `market-gateway/package.json`, `Dockerfile` or the gateway runtime configuration.

Selecting a Redis client before the deployment topology, managed Redis product, TLS/ACL mechanism, connection limits and operational owner are approved would create an unverified runtime dependency.

## Target topology (not yet implemented)

1. A separately supervised central-feed worker owns the licensed provider connection and publishes normalized events.
2. Each gateway process owns one dedicated Redis subscriber connection (not one per browser/user).
3. The gateway authenticates the user with Supabase and authorizes every requested instrument before attaching the user's socket/SSE sender to authenticated fan-out.
4. Redis events are validated against channel identity, payload identity, schema, provider sequence and freshness before fan-out.
5. Redis publisher and subscriber connections are separate from request/database clients. Credentials are server-only, TLS is mandatory, ACL permissions are least-privilege, and network access is private.
6. The current direct Upstox `/stream` route remains unchanged until a separately reviewed migration proves parity and rollback.

## Reconnect contract to implement after client selection

- Treat disconnect, reconnecting, ready, end and error as explicit lifecycle states.
- On disconnect: mark the feed unavailable immediately; stop forwarding and mark cached quotes stale.
- On ready: restore the single pattern subscription exactly once. Do not issue a duplicate subscribe if the selected Redis client automatically restores subscriptions.
- Keep a monotonically increasing process generation so late callbacks from an old connection cannot dispatch.
- Detect source-sequence gaps per instrument. A gap invalidates continuity; do not silently replay or fabricate ticks. Mark affected instruments stale and request a fresh authoritative snapshot before returning to healthy.
- Bound reconnect attempts with exponential backoff and jitter; after the configured ceiling, remain degraded and expose a health signal rather than spinning.
- On shutdown: stop accepting subscriptions, invalidate the generation, unsubscribe only owned patterns if still connected, drain bounded in-flight dispatch, then close only the dedicated client.
- Never close a shared Supabase or unrelated application client.

## Required integration tests

1. Initial connection subscribes exactly once.
2. Repeated ready events do not duplicate the subscription.
3. Disconnect immediately blocks dispatch and marks data stale.
4. Reconnect restores one subscription, whether restoration is client-managed or host-managed (test the selected client behavior explicitly).
5. Old-generation callbacks after reconnect are ignored.
6. Sequence gaps mark data stale and require a fresh snapshot.
7. Subscription restoration failure stays degraded and retries with bounded backoff.
8. Shutdown during reconnect prevents resubscribe and closes only the owned client.
9. Multiple gateway instances each own one subscriber and do not share mutable fan-out state.
10. Auth, entitlement revocation, back-pressure and tenant isolation remain enforced end-to-end.

## Release gates

- Select and document the managed Redis service, client package/version, topology, TLS/ACL setup, timeout/retry policy, max clients, memory/eviction policy and monitoring.
- Verify provider/exchange written rights explicitly cover paper trading, multi-user display and redistribution, storage/retention and Redis transport.
- Keep the existing documentary rights and regulatory approval gates closed until those approvals are recorded.
- Keep the implementation in Draft PRs. No production wiring, deployment, live data, real broker orders or scheduled LIMIT worker activation is authorized by this plan.

## Current status

Planning only. No Redis package, environment variable, secret, network connection, reconnect handler or production route is added by this document.