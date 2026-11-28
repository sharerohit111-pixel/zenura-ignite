# Redis Subscriber Lifecycle Coordinator

This module is an injected, provider-neutral lifecycle adapter. It deliberately does not import a Redis package, create a connection, or select a reconnect policy.

## Contract

- The selected Redis client owns connection establishment and bounded reconnect/backoff policy.
- The host supplies `ensureSubscription`; it must be idempotent for the supplied connection generation and must match the selected client's auto-resubscribe behavior.
- A ready event subscribes at most once for the current generation.
- `reconnecting` invalidates the active generation once and exposes the explicit `reconnecting` state; a following `end` settles it to `unavailable` without invalidating the same connection loss twice. An `end` without a preceding reconnect event invalidates the generation and immediately marks the feed unavailable through `markUnavailable`.
- Dispatchers must use `dispatchIfCurrent(generation, fn)` or `isCurrentGeneration(generation)` to suppress late callbacks.\n- External safety events such as subscriber queue overflow can call `invalidate(reason)`. This immediately invalidates the active generation, marks the feed unavailable through `markUnavailable`, and blocks dispatch until a fresh ready generation is established. Repeated invalidation while already unavailable is idempotent.
- Subscription failure leaves the lifecycle degraded; the client/host decides when the next ready attempt occurs.
- Shutdown removes only listeners installed by this module. It closes the Redis client only when `closeOwnedClient: true`.
- This module does not perform source-sequence validation, snapshot recovery, auth, entitlement checks or fan-out; those remain separate contracts.

## Required client-selection follow-up

Before production wiring, document whether the chosen client automatically restores pattern subscriptions, its ready/reconnecting/end event semantics, TLS and ACL options, timeout behavior, retry ceiling, and shutdown semantics. Adapt `ensureSubscription` to that exact behavior and test it against the real client in an isolated integration environment.

No package dependency, runtime configuration, Cloud Run networking, Secret Manager entry, production route or deployment is added here.
