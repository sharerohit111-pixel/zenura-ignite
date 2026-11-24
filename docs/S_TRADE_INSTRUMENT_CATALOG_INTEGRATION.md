# S-TRADE canonical NSE/BSE and MOCK instrument catalog integration

Date: 2026-11-24

## Canonical ownership

| Concern | Canonical owner | Integration rule |
|---|---|---|
| Live NSE/BSE equity and index master | Existing Upstox BOD cache and authenticated `/instruments` route | Never import Dummy fixtures into the production gateway |
| Live search ranking | PR #124 `rankInstrumentSearchResults` | Keep one live relevance-ranking helper |
| Live Futures contract normalization and depth | PR #126 | Keep its provider adapter separate from browser Demo fixtures |
| Live market depth, exchange status, expiry and strike controls | PR #134 | Reuse existing live BOD cache and authenticated provider routes |
| Versioned Dummy JSON schemas and base fixtures | PR #137 | Sole Demo contract source; every identity uses `MOCK|` and every envelope is `mode=MOCK`, `simulated=true` |
| Derivative MOCK contracts and quotes | PR #149 derivative fixture extension | Reuse the shared derivatives fixture; no second derivatives master |
| Browser-safe Demo view model | PR #145 | Single read-only adapter, explicit opt-in, no production fallback |
| 15-screen Demo workspace and legacy route | PR #150 and PR #152 | Consume the canonical adapter and shared fixtures |
| Instrument search, filters, expiry discovery and option chain | This PR | Pure functions over the one adapter's normalized `market.instruments` collection |

## Audited PR disposition

- **#123:** closed and unmerged; earlier overlapping Futures implementation. #126 is the refreshed canonical Futures foundation.
- **#124:** retain; its relevance ranking remains the live-search implementation.
- **#126:** retain; live Futures contract/depth foundation. Its separate split-depth lot validation and effective-dated session-policy review findings remain outside this Demo catalog PR.
- **#134:** retain; live NSE/BSE depth/status and existing instrument selection UI.
- **#144:** superseded for Demo instrument data. Its separate `mock-instrument-master.json` uses exchange-style `NSE_EQ|` / `NSE_FO|` keys and is not the shared `MOCK|` contract. Do not merge it alongside #137/#149. Preserve the PR and mark it superseded rather than deleting history.
- **#137/#145/#149/#150/#152:** canonical Demo contract, adapter, derivative fixture extension, screens and integration path.

## Normalized Demo catalog

The browser adapter exposes one immutable `market.instruments` collection covering:
- MOCK equity and index quote fixtures from `market.json`
- MOCK Futures and CE/PE Options contracts joined to deterministic bid/ask fixtures from `derivatives.json`

Every row has one `instrumentKey`, `symbol`, `exchange`, `assetClass`, `underlying`, `expiry`, `optionType`, `strikePaise`, lot/tick metadata, synthetic quote/depth values, timestamp and stale flag. Duplicate keys, orphan quotes, missing contract quotes, malformed expiry, invalid exchange and non-MOCK identities fail closed.

The adapter exports pure `searchPaperDemoInstruments`, `getPaperDemoExpiries`, and `getPaperDemoOptionChain` functions. The Demo screens use these functions for symbol search, NSE/BSE and asset-class filters, Futures expiry selection, and paired CE/PE option-chain strike selection.

## Safety boundaries

- Synthetic prices and contract metadata are illustrative only; persistent labels say DEMO / MOCK.
- No official NSE/BSE live prices are fabricated.
- No market-gateway demo routes or imports are added. No Demo fixture or browser adapter is imported into `supabase-server.js` or `server.js`.
- Authenticated live quotes, provider adapters, orders, accounting, wallet, ledger, workers, Crypto and production routes remain separate.
- The Demo remains read-only and keeps `ledgerReconciled=false`.
