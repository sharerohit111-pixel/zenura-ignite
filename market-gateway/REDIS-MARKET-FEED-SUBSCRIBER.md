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
4. Add metrics and bounded back-pressure at the host queue; this adapter intentionally serializes processing and should be load-tested against expected tick rates.
5. Test Redis reconnect/resubscribe behavior and shutdown ordering before runtime wiring.
6. Keep vendor and exchange rights/regulatory gates closed until executed approvals explicitly cover S-TRADE paper trading and multi-user distribution.

No current gateway route, UI, broker order flow, Supabase schema, Crypto code or production runtime is changed by this module.
