# ZENURA IGNITE — Approved Product Scope

Updated: 2026-11-22

## Product boundary

ZENURA IGNITE is a **Paper Trading only** product. There is one user-facing mode: Paper Trading.

- Indian stock-market Paper Trading: NSE/BSE cash equities, Intraday and Delivery, futures, options, virtual orders, balances, positions, P&L, watchlists and history.
- Cryptocurrency Paper Trading remains in scope and must be preserved.
- Paper Investing is out of scope and must be removed from user-facing navigation, routes, pages, APIs, dedicated database objects/RPCs, tests and documentation.
- Do not remove or disable shared infrastructure merely because Paper Investing used it.

## Shared infrastructure to preserve

- Native Supabase Auth, JWT verification, RLS and tenant isolation.
- Common market gateway, Upstox OAuth/token protection, instrument master, quote/candle/stream services.
- Shared chart engine, indicators, chart themes, saved chart preferences and drawings.
- Shared watchlists and Paper Trading accounts, equity orders, reservations, futures/options, protective-order infrastructure.
- Crypto Paper Trading implementation and its tests.
- PWA shell, language toggle, responsive styles and common market portal assets.

## Safe removal rules

1. Keep this work on the existing Paper Trading draft PR. Do not merge or deploy.
2. Do not modify production Supabase or import/delete customer data.
3. Do not rewrite migration files already recorded in remote migration history. Use a forward-only cleanup migration for dedicated Investing objects after dependency checks.
4. Before dropping a table or RPC, prove it is not referenced by stock, crypto, shared chart/watchlist, auth, worker, deployment or rollback paths.
5. Do not remove shared objects such as the futures/chart migration wholesale: extract only dedicated Investing objects after auditing dependencies.
6. Preserve existing Paper Trading balances, positions, orders, histories and crypto behavior.
7. Re-run the complete migration smoke, tenant-isolation, order accounting, stock, crypto, PWA and browser checks after cleanup.

## Release gates still applicable

- No public real-time market feed until provider permissions and legal/compliance review are documented.
- No production gateway deployment until cloud identity, secrets, origins, OAuth redirects, SMTP and authenticated end-to-end checks are complete.
- Protective stop-loss/target execution must have a tested always-on server worker before being advertised as guaranteed.
- Futures LIMIT and other unsupported order types must remain disabled until their complete reservation/fill/cancel lifecycle is implemented and tested.
- Android device performance, signing, Play Store declarations and staged rollout checks remain required.

## Current cleanup status

- Portal, stock navigation, PWA manifest and service-worker asset list now expose/cache Paper Trading only.
- Dedicated Investing page/client/styles/tests and four gateway API routes have been removed.
- A forward-only migration retires the three dedicated Investing ledger tables and two Investing-only RPCs without rewriting prior migration history or using CASCADE.
- CI no longer runs Investing UI/ledger tests or expects Investing tables/RPCs; shared RLS, chart, watchlist, OAuth and trading checks remain.
- The latest cleanup CI run is still in progress. The migration has not been applied to production Supabase; no production data or service has been modified.
- Crypto Paper Trading remains protected from this cleanup.
