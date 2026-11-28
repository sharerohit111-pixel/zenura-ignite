# Redis Market-Feed Subscriber Bridge — Engineering Notes

## Status

This is an isolated Redis pattern-subscriber adapter. It does not create or own a Redis connection, open a public socket, authenticate end users, or grant data rights. It forwards validated channel events to the authenticated fan-out module through an injected `fanout.dispatch(event)`.

## Safety contract

- Subscribes only to `s-trade:market-data:*`.
- Decodes and validates the instrument identifier from the channel.
- Parses bounded JSON and requires the payload instrument ID to exactly match the channel.
- Serializes message processing to preserve arrival order within this adapter.
- Reports rejected messages through an injected error callback; malformed messages are not dispatched.
- Unsubscribes only its own pattern subscription and never closes the shared Redis client.
- Does not trust channel names as authorization. Per-user access remains the responsibility of the authenticated fan-out module.

## Host integration prerequisites

1. Create a dedicated Redis subscriber client with TLS, ACL credentials, network restrictions and reconnect policy supplied by the host.
2. Instantiate this bridge once per gateway process, not once per WebSocket client.
3. Connect `fanout.dispatch` to the authenticated fan-out instance and ensure revocation propagates across replicas.
4. Wire `onOverflow` to the lifecycle coordinator so the affected feed becomes unavailable/stale and clients are forced through authoritative snapshot recovery. Export queue depth, rejected count and overflow count as metrics; load-test the configured queue bound against expected tick rates.
5. The current adapter does not implement reconnect or resubscribe. The host must own Redis client reconnect detection, subscription restoration, duplicate-subscription prevention and shutdown ordering; add integration tests for disconnect/reconnect, missed-message gaps and resubscribe failure before runtime wiring.
6. Keep vendor and exchange rights/regulatory gates closed until executed approvals explicitly cover S-TRADE paper trading and multi-user distribution.

No current gateway route, UI, broker order flow, Supabase schema, Crypto code or production runtime is changed by this module.


## CI dependency note

The subscriber bridge test workflow is evaluated against the authenticated fan-out stack branch so the CI checkout contains the fan-out implementation as well as the Redis bridge. The pull request remains Draft until the complete stacked test run passes.
