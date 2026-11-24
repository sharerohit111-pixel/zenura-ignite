# Provider routing and operating controls

**Status:** Provider-neutral engine scaffold and deterministic tests. It is not wired into public API routes and does not activate any provider.

## Configuration model

The router receives an explicit, server-owned ordered provider plan per capability:

- quote
- candles
- depth
- instrumentMaster
- stream

This allows different sources for quotes, candles, depth, instrument masters and streaming. The plan must be supplied by trusted server configuration, never by a browser request. Unknown providers are skipped and cannot be called. No credentials or provider is enabled by this configuration alone.

Every request resolves a user-, provider-, capability-, instrument- and exchange-specific entitlement. The resolver must return an approved record with a durable reference. A missing, expired, ambiguous or failed entitlement lookup is treated as not approved.

## Fallback policy

The router may try the next independently approved provider when:
- the provider is unhealthy or unreachable;
- a bounded upstream timeout/network/rate-limit/server failure occurs;
- a response fails canonical validation (wrong instrument, stale/future quote, incomplete depth, invalid candle sequence, stale/duplicate instrument master).

The router never merges fields from different providers. One complete response from one provider is returned with its provider attribution and entitlement reference. If no provider returns a valid response, the request fails closed.

Fallback does not imply a provider's permissions transfer to another provider. The next provider must pass its own entitlement check for the same user, instrument, exchange and capability.

## Canonical market-data rules

- Prices are positive integer paise; floating-point rupee values must be converted and validated in the provider adapter before entering the canonical model.
- Quotes carry provider ID, canonical instrument ID, exchange, receive timestamp, exchange snapshot timestamp, last-trade timestamp, source event identity, attribution and entitlement reference.
- Depth carries a fresh snapshot timestamp, source sequence, ordered bids descending and asks ascending, positive quantities, at most 30 levels per side, and a non-crossed best bid/ask.
- Candles carry strictly increasing timestamps, integer-paise OHLC values, non-negative volume, and internally consistent high/low bounds.
- Instrument masters carry a source reference, generation timestamp, unique canonical instrument IDs and exchange identity. The current scaffold rejects masters older than seven days; production adapters should enforce the provider's official daily publication and exchange-specific validity schedule.
- Streams must expose an explicit close operation and a subscription or async-iteration interface so callers can clean up on disconnect and shutdown.

## Rate limits and deployment warning

`ProviderRateLimitPolicy` currently provides a deterministic in-process per-user/per-operation window for adapter tests and single-process protection. It is **not** a distributed quota coordinator. It must not be treated as sufficient for multiple Cloud Run instances or provider-wide/API-key quotas.

Before production adapter activation, replace or wrap it with an atomic shared limiter (for example, a Postgres RPC or Redis Lua script) that enforces both:
1. provider/account-wide quotas across all application instances; and
2. user/client-specific quotas where provider rules require them.

Honor provider `Retry-After`, documented daily/hourly/minute limits, WebSocket connection limits, instrument subscription caps, and plan entitlements. Do not retry non-idempotent broker orders automatically.

## Health monitoring and outage testing

Provider adapters should expose:
- transport connectivity;
- authentication/token validity;
- feed age and last successful event time;
- subscription count and rejected subscriptions;
- rate-limit state and Retry-After;
- reconnect attempt count and last disconnect reason;
- last successful instrument-master refresh and source checksum.

Do not mark a provider healthy solely because its TCP/WebSocket connection is open. Feed freshness, authentication and entitlement must be checked separately.

Outage tests should include timeout, connection reset, HTTP 401, HTTP 429, 5xx, WebSocket close, silent feed, stale/future timestamps, sequence gaps, wrong instrument, crossed depth, malformed candles, expired entitlement, and simultaneous primary/secondary failure.

## Release gates

1. Provider docs, API terms, rate limits and user plan rechecked on implementation date.
2. Written provider and exchange data rights for the exact simulator use case.
3. Counsel review of SEBI and NSE restrictions.
4. Provider adapter contract and fixture tests pass.
5. Cross-instance rate limiter and health monitoring deployed.
6. No credential or provider enabled until explicit owner approval.
7. Broker execution adapter remains independent and disabled; real orders require separate written owner approval and broker entitlement.
