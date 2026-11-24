# S-TRADE Core UI & Navigation — Dummy Dashboard

## Scope
This isolated route adds the Indian Market Paper Trading dashboard at `/markets/dashboard/`. It does not replace the existing `/markets/stocks/` workspace.

## Screens
- Home — virtual account summary, sample NSE/BSE indices and quick navigation.
- Market — searchable Equity, Futures and Options instrument list.
- Watchlist — sample saved symbols with in-memory add/remove controls.
- Orders — sample filled, pending and cancelled order records with status filters.
- Portfolio — virtual cash, blocked funds, invested value, P&L and sample performance chart.
- Positions — sample Futures and long Options positions.
- Holdings — sample Delivery equity holdings.
- Profile — demo account profile.
- Settings — local theme, language and demo-alert preferences.

## Data contract
- `mock-data.json` is the only data source for all dashboard screens.
- `meta.provider` must remain `DUMMY_JSON` and `meta.mode` must remain `DEMO`; the view model rejects other values.
- All prices, balances, fills, P&L, index values, volume and timestamps are illustrative fixtures, not exchange data or accounting records.
- The dashboard has no Supabase, Firebase, Upstox, market-gateway or order submission dependency.
- User preferences may be stored locally; mock orders, balances and holdings are not persisted as real account data.
- The ₹10,00,000 opening capital is a demo fixture consistent with the product's paper-account starting-capital design.

## Integration boundary
- The existing market portal links to both this dashboard and the existing connected `/markets/stocks/` workspace.
- Existing order engine, accounting ledger, authentication, chart engine, market-data adapters, watchlists and Crypto code are not modified by this dashboard module.
- No Paper Investing surface, broker execution, live feed, database migration, production deployment or feature activation is introduced.

## Verification
Run with Node 22:
```sh
node --input-type=module --check < markets/dashboard/dashboard.js
node --input-type=module --check < markets/dashboard/dashboard-model.js
node --test markets/dashboard/dashboard-model.test.js markets/stocks/dashboard-contract.test.js
```

The tests assert the nine-screen navigation contract, local Dummy JSON source, demo-only labeling, Indian-market fixture segments and portal links. They are source-level tests; they do not represent browser/device QA.
