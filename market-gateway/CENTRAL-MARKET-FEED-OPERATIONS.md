# Central Market Feed Engine — Operations and Integration Notes

## Status

The central coordinator and Redis publisher adapter are engineering scaffolding only. No vendor client, Redis connection, deployment, or live feed has been configured. Keep the existing market-data rights and regulatory approval gates enabled.

## Modules

- `lib/central-market-feed.js`: bounded instrument allowlist, provider health check, global rights gate, per-instrument entitlement validation, normalized snapshot validation, duplicate sequence rejection, and safe stream lifecycle.
- `lib/redis-market-feed-transport.js`: injected Redis publisher adapter. It publishes JSON only to `s-trade:market-data:*`, rejects oversized messages, and never creates its own Redis connection.
- `test/central-market-feed.test.js` and `test/redis-market-feed-transport.test.js`: deterministic contract tests with injected fake provider and transport clients.

## Required integration contract

A selected licensed vendor adapter must provide:

- `providerId` — a stable, reviewed identifier.
- `getHealth()` — returns `{ healthy: true }` only when the upstream session is usable.
- `openStream({ instruments, onEvent, onError })` — returns an object with an async `close()` method and sends normalized events to `onEvent`.

Each event must match the selected provider and configured instrument and contain the complete provider-neutral snapshot fields required by `normalizeMarketDataSnapshot`.

The central feed additionally requires:
- `assertRightsApproved()` — backed by the existing dual documentary approval gate.
- `resolveProviderEntitlement({ providerId, instrumentId, exchange })` — returns explicit provider, paper-trading, redistribution, rights-reference and regulatory-reference approval fields.
- `transport.publish(channel, event)` — supplied by the host runtime.

## Runtime integration is intentionally not wired yet

Do not import and start this service automatically from `supabase-server.js`. The current gateway still has a direct Upstox per-user stream path and a different lifecycle/entitlement model. A migration must first prove that:
1. every current route and consumer uses the intended source contract;
2. user subscriptions are authenticated and independently authorized before Redis fan-out;
3. the central worker has a separate process/lease and cannot be started once per web-server replica;
4. disconnect, revocation, reconnect, back-pressure, and shutdown are tested end-to-end;
5. Redis access, TTL, persistence and retention match the executed vendor agreement.

## Test command

Run from `market-gateway`:

```sh
npm test -- --test-name-pattern="central feed|Redis transport"
```

The full existing gateway suite remains `npm test`. No test result is implied by the presence of these test files; exact-head CI must run.
