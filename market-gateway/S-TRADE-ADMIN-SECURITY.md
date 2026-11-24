# S-TRADE notifications and administration security

This module is server-side only. It is not a production deployment or a migration approval.

## Protected endpoints

All endpoints are mounted under `/s-trade`. They require a valid Supabase bearer session and use the existing distributed per-user request budgets from PR #125.

- `GET /notifications`, `POST /notifications/:id/read`
- `GET /preferences`, `PUT /preferences`
- `GET /price-alerts`, `POST /price-alerts`, `DELETE /price-alerts/:id`
- `GET /admin/overview`, `GET /admin/users?page=N`
- `POST /admin/users/:id/status` with `{ "disabled": boolean, "reason": "..." }`
- `GET /admin/providers`, `GET /admin/audit`
- `POST /admin/controls/:key` with `{ "enabled": boolean, "reason": "..." }`

The static pages are `markets/stocks/notifications.html` and `markets/stocks/admin.html`. Admin authorization is always rechecked by the backend; hiding a link or changing browser state grants no privilege.

## Administrator bootstrap

There is deliberately no public API to grant or revoke administrators. The first administrator must be enrolled by a separately approved privileged database operation after verifying the target Supabase Auth UUID out of band.

Example first-admin bootstrap (replace placeholders; do not commit the UUID or run this against production without approval):

```sql
INSERT INTO public.s_trade_admins(user_id, granted_by, reason)
VALUES ('<VERIFIED_AUTH_USER_UUID>'::uuid, NULL,
        'Approved initial S-TRADE administrator bootstrap');
```

For later grant/revoke operations, the trusted operator should set the verified actor in the same database transaction so the append-only audit trigger records the actual operator:

```sql
BEGIN;
SELECT set_config('s_trade.actor_user_id', '<VERIFIED_OPERATOR_AUTH_UUID>', true);
INSERT INTO public.s_trade_admins(user_id, granted_by, reason)
VALUES ('<TARGET_AUTH_USER_UUID>'::uuid, '<VERIFIED_OPERATOR_AUTH_UUID>'::uuid,
        'Approved administrator access change');
COMMIT;
```

Revocation uses a reasoned delete in the same transaction after setting `s_trade.actor_user_id`. The registry trigger writes grant/revoke events to `s_trade_admin_audit_log`; API roles cannot write the registry. Audit rows are append-only and have no browser read grant.

## Price alerts and provider health

- The alert API accepts only instruments present in the official NSE/BSE instrument master.
- The database enforces a 50-active-alert per-user cap under an advisory transaction lock; the gateway also performs an early quota check.
- The worker is disabled by default. It runs only when `S_TRADE_PRICE_ALERT_WORKER_ENABLED=true`, uses each owner's encrypted Upstox connection, requests bounded quote batches, rejects stale quotes, and calls the service-only atomic evaluator.
- `S_TRADE_PRICE_ALERT_WORKER_INTERVAL_MS` is clamped to 5–60 seconds. The worker processes at most 500 alert rows and 50 user accounts per cycle.
- Provider health records HTTP results from the Upstox API without persisting credentials or raw response bodies. WebSocket health is not yet included.
- Email and push preferences are stored as disabled-by-default flags. No delivery provider is configured or invoked.

## Operational controls

- `new_orders_enabled=false` blocks authenticated new simulated order submissions at the gateway.
- `provider_upstox_enabled=false` blocks Upstox market-data HTTP requests; OAuth/token-management endpoints remain available for account disconnection/recovery.
- `price_alerts_enabled=false` blocks alert creation and database evaluation.

All controls fail closed if their database state cannot be read. Missing rows preserve the existing default-enabled behavior.

## Verification

The migration is draft-only. CI runs the new JavaScript unit tests and PostgreSQL RLS/tenant-isolation, notification-trigger, price-alert quota, admin registry audit and service-role privilege checks. No production migration or deployment is performed by this branch.
