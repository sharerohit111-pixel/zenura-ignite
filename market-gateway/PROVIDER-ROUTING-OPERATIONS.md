# Provider routing and operating controls

**Status:** Provider-neutral engine scaffold, atomic shared-quota foundation and deterministic tests. It is not wired into public market-data API routes and does not activate any provider.

## Configuration model

The router receives an explicit, server-owned ordered provider plan per capability: quote, candles, depth, instrumentMaster and stream. The plan must be trusted server configuration, never browser input. Unknown providers cannot be called.

Every request resolves a user-, provider-, capability-, instrument- and exchange-specific entitlement. Missing, expired, ambiguous or failed entitlement lookup is treated as not approved.

## Fallback policy

The router may try the next independently approved provider when the provider is unhealthy, an upstream transient failure occurs, a response fails canonical validation, or that provider's own shared quota is exhausted or unconfigured.

The router never merges fields from different providers. One complete response from one provider is returned with its attribution and entitlement reference. The next provider must pass its own entitlement and shared-quota checks. If no provider passes, the request fails closed.

## Canonical market-data rules

- Prices are positive integer paise; adapters must convert and validate before entering the canonical model.
- Quotes carry provider ID, canonical instrument ID, exchange, receive timestamp, exchange snapshot timestamp, last-trade timestamp, source event identity, attribution and entitlement reference.
- Depth carries a fresh snapshot timestamp, source sequence, descending bids, ascending asks, positive quantities, at most 30 levels per side, and a non-crossed best bid/ask.
- Candles carry strictly increasing timestamps, integer-paise OHLC values, non-negative volume, and consistent high/low bounds.
- Instrument masters carry a source reference, generation timestamp, unique canonical instrument IDs and exchange identity. The scaffold rejects masters older than seven days; production adapters must enforce the provider's official publication and exchange-specific validity schedule.
- Streams must expose an explicit close operation and a subscription or async-iteration interface.

## Distributed quota enforcement

The consume_market_data_provider_quota PostgreSQL RPC uses row locks and one transaction to enforce provider-account-wide and per-user fixed-window quotas across all gateway instances. The account bucket is locked before the user bucket consistently; both counters increment together or neither increments. Denials return a retry duration without consuming either bucket.

The server-only createDistributedProviderRateLimiter adapter calls this RPC, and the router invokes it before provider health checks or upstream calls. A missing policy or unavailable quota service skips that provider; it never falls back to a process-local limiter. If no provider passes its quota gate, the request fails closed.

**No provider quota policy is seeded or enabled by this migration.** Before enabling a provider, an operator must verify the actual provider account, plan, operation definitions, contractual limits and windows, then insert an enabled policy row using those exact values. Do not invent limits from examples or generic documentation.

The in-memory ProviderRateLimitPolicy remains useful for isolated unit tests only. It is not the production quota authority. The server-only prune_market_data_provider_quota_buckets RPC provides bounded cleanup (maximum 10,000 rows per call), refuses cutoffs newer than 24 hours, and skips rows updated after the cutoff. Schedule it through an approved maintenance runner after deployment; no cron schedule is enabled by this migration. Monitor deleted-row counts and table growth.

Honor provider Retry-After, documented daily/hourly/minute limits, WebSocket connection limits, instrument subscription caps, and plan entitlements. Do not retry non-idempotent broker orders automatically.

## Health monitoring and outage testing

Provider adapters should expose transport connectivity, authentication/token validity, feed age, last successful event time, subscription count, rejected subscriptions, rate-limit state, Retry-After, reconnect attempts, last disconnect reason, and instrument-master refresh/checksum.

Do not mark a provider healthy solely because its TCP/WebSocket connection is open. Feed freshness, authentication and entitlement must be checked separately.

Outage tests should include timeout, connection reset, HTTP 401/429/5xx, WebSocket close, silent feed, stale/future timestamps, sequence gaps, wrong instrument, crossed depth, malformed candles, expired entitlement, simultaneous primary/secondary failure, missing quota policy, provider quota exhausted, and quota database unavailable.

## Release gates

1. Provider docs, API terms, rate limits and user plan rechecked on implementation date.
2. Written provider and exchange data rights for the exact simulator use case.
3. Counsel review of SEBI and NSE restrictions.
4. Provider adapter contract and fixture tests pass.
5. Shared quota migration tested under concurrent transactions; actual provider policies configured only from verified contractual limits.
6. Provider health monitoring and quota bucket retention deployed.
7. No credential or provider enabled until explicit owner approval.
8. Broker execution adapter remains independent and disabled; real orders require separate written owner approval and broker entitlement.
