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

## Deployment-specific recommendation (researched; not provisioned)

The existing deployment guide places the gateway on Google Cloud Run in `asia-south1` (Mumbai). The lowest-friction managed Redis fit is therefore **Google Cloud Memorystore for Redis**, in the same region and VPC as Cloud Run, rather than introducing a second cloud provider.

- Prefer the standard Memorystore for Redis service (single primary/replica topology) for the first production design; do not choose Redis Cluster until measured throughput or data size requires sharding.
- Use Cloud Run **Direct VPC egress** to reach the instance's private IP. Google documents this as the recommended Cloud Run connection path, with lower latency, higher throughput and no connector instance overhead. The existing deployment workflow currently does not configure VPC egress, so this is an infrastructure change that must be separately reviewed.
- Use private IP only, TLS/in-transit encryption and Redis AUTH where supported by the selected instance configuration. Store credentials in Google Secret Manager; never in browser config, source code, or GitHub plaintext variables.
- Select Standard Tier for a production multi-zone availability requirement only after the cost is approved. A Basic Tier can be used for isolated non-production integration testing, but must not be mistaken for production HA.
- Keep the Redis instance and Cloud Run in `asia-south1` to avoid cross-region traffic and latency. Confirm current SKU availability and exact monthly estimate in the target GCP project before provisioning.
- The Cloud Run service can scale to multiple instances. Each gateway instance must own exactly one dedicated subscriber connection and its own local fan-out registry; do not assume one global subscriber. The separate publisher/central-feed worker needs its own supervised runtime and lease/ownership design.
- Redis Pub/Sub is transient and does not provide durable replay. On reconnect or sequence gap, affected instruments must remain stale until a fresh authoritative snapshot is obtained; never treat reconnect as proof that no ticks were missed.

Official Google references:
- Cloud Run to Memorystore connectivity and Direct VPC egress: https://docs.cloud.google.com/memorystore/docs/redis/connect-redis-instance-cloud-run
- Cloud Run Direct VPC egress comparison: https://docs.cloud.google.com/run/docs/configuring/connecting-vpc
- Memorystore Redis pricing and regional selection: https://cloud.google.com/memorystore/docs/redis/pricing
- Memorystore Redis AUTH and in-transit encryption configuration: https://docs.cloud.google.com/memorystore/docs/redis/create-manage-instances

This is an architecture recommendation only. No Redis resource has been provisioned, no VPC/networking/IAM/secrets have been changed, and no runtime package has been selected or installed. The user/project owner must approve the GCP budget and infrastructure change before provisioning.

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