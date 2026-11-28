# Authenticated Market-Feed Fan-out — Engineering Notes

## Status

This module is an isolated authorization/fan-out primitive. It is not connected to an HTTP/WebSocket route, Redis subscriber, Supabase Auth, or a production process. It does not make any market-data rights determination.

## Contract

- The host must authenticate the credential and return a trusted `{ userId, tenantId }` principal.
- The host must independently authorize every requested instrument and return `{ allowed: true, entitlementReference }` only when the account is entitled.
- The caller supplies a connection-scoped `send(event)` callback. Only events matching that connection's approved instrument set are delivered.
- Revocation is scoped to the exact user and tenant pair. Disconnect uses the returned `unsubscribe()` handle.
- Failed sends remove the affected connection. Connection and per-connection instrument counts are bounded.

## Integration requirements

Before wiring this into a gateway route, implement and test:
1. Supabase/JWT authentication in the host route; never trust userId or tenantId from client payloads.
2. Entitlement lookup from authoritative server-side records on every subscribe and on revocation.
3. A Redis subscriber with strict channel parsing that extracts and validates the instrument ID before calling `dispatch(event)`.
4. WebSocket origin, session, rate, message-size and connection-lifetime controls.
5. Revalidation/revocation propagation across all gateway replicas.
6. Integration tests proving no cross-tenant delivery, stale entitlement rejection, disconnect cleanup and back-pressure behavior.

This module intentionally does not open sockets, create Redis connections, access secrets, or start itself from the existing gateway. Keep the existing rights and regulatory gates closed until executed provider and exchange approvals explicitly cover the product and multi-user display/redistribution.
