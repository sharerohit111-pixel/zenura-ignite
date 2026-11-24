# S-TRADE multi-provider capability matrix

**Audit date:** 2026-11-24  
**Status:** Documentation-only provider evaluation. No additional provider is connected or enabled.

## Non-negotiable distinction

API capability is not a data licence. A logged-in retail API account, a successful OAuth flow, a market-data endpoint, or an instrument download does not by itself authorize ZENURA IGNITE to display, redistribute, cache, or use that data in a public virtual-trading product. Every provider/use-case pair requires written entitlement review.

Market-data acquisition and broker execution are separate provider roles. Never infer that a provider's market-data permission also authorizes order placement, or vice versa.

## Capability matrix

| Provider | Live quote / stream | OHLC / candles | Depth | Instrument master | Auth model (documented at a high level) | Limits / qualifications | Current integration decision |
|---|---|---|---|---|---|---|---|
| Upstox | REST full quotes; V3 WebSocket with LTPC, Full (5-level) and Plus Full D30 modes | Historical candle APIs; V3 stream carries selected intraday/day OHLC fields | V3 Full 5 levels; Full D30 30 levels (Plus entitlement) | Official downloadable exchange instrument files | OAuth authorization-code flow; user authorization and server-side token storage | V3: 2 connections/user; LTPC 5,000 individually / 2,000 combined; Full 2,000 individually / 1,500 combined; Plus D30 50 individual / 1,500 combined | Existing Upstox REST/Protobuf modules plus new injected provider-neutral normalization adapter. No public route activation; provider transport/stream codec integration and written use-case approval remain outstanding. |
| Zerodha Kite Connect | REST quote snapshots; WebSocket stream | Historical candles | Full WebSocket mode includes 5-level depth | Daily instrument dump / instrument tokens | Kite Connect login and access-token session | WebSocket: 3 connections/API key, 3,000 instruments/connection. Documented quote REST limit 1 req/sec; historical 3 req/sec | **Do not implement for S-TRADE paper trading:** Kite Connect terms expressly prohibit API/live data use for virtual/mock trading apps. Reconsider only if a new written agreement explicitly overrides this restriction. |
| Angel One SmartAPI | Live Market Data API LTP/OHLC/FULL; WebSocket streaming documented | Historical candle API | FULL snapshot includes best 5 buy/sell levels; verify stream depth separately | Scrip master / search-scrip; verify current file format and permitted use | SmartAPI login/JWT + feed token (exact lifecycle to be verified before implementation) | Published Market Data quote limit: 10 req/sec, 500/min, 5,000/hour; historical: 3/sec, 180/min, 5,000/hour. Limits are per client code | API shape documented; **normalization adapter implemented behind injected transport**, but not connected/enabled. REST quote/FULL depth/candles and instrument mapping are covered by fixtures. A provider-specific binary WebSocket decoder and production transport wiring remain outstanding. Written confirmation of paper-simulation use, public display, redistribution, user scope and exchange rights is mandatory. |
| DhanHQ | Live WebSocket market feed | Historical daily and intraday candles | Live feed supports 5-level; separate 20-level and 200-level WebSockets, only NSE Equity and Derivatives for Full Depth | Official instrument list / security IDs | User-specific access token and client ID | Live feed: up to 5 sockets/user and 5,000 instruments/socket. 20-level depth: up to 50 instruments/connection. Confirm current account/API plan limits before implementation | **Blocked for live-data paper trading:** Dhan support explicitly says paper trading with virtual funds and live market data is not supported. No adapter or routing. |
| FYERS | Data Socket live symbol/index/depth updates; separate TBT socket | Historical candles | 5-level standard depth; TBT up to 50-level for NFO and NSE equity, subject to plan | Symbol master JSON/file | App ID + OAuth access token | Standard Data Socket: 100 symbols/user; Prime: 5,000. TBT Standard 1 symbol; Prime 15 symbols. Data API Standard 5/sec, 50/min, 5,000/day; Prime 10/sec, 500/min, 500,000/day | **Blocked for S-TRADE paper trading:** FYERS API terms prohibit using exchange data to develop paper-trading, gaming, or virtual-trading tools. Its API terms also restrict third-party content redistribution without written consent. No adapter or routing. |
| NSE Data / authorized vendors | Product-specific licensed feeds | Product-specific licensed historical data | Depends on subscribed product | Paid Master Data product available | Commercial subscriber agreement and exchange/vendor provisioning | Commercial pricing, display/non-display, user counts, redistribution and simulator use are agreement-specific | Preferred route to investigate for app-wide rights; no subscription or entitlement assumed |

## Provider evidence (official documentation)

- Upstox V3 feed, modes and connection/subscription limits: https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
- Upstox full market quote: https://upstox.com/developer/api-documentation/get-full-market-quote/
- Kite WebSocket, depth and connection limits: https://kite.trade/docs/connect/v3/websocket/
- Kite quotes and instrument snapshots: https://kite.trade/docs/connect/v3/market-quotes/
- Kite historical candles and intervals: https://kite.trade/docs/connect/v3/historical/
- Kite rate limits: https://kite.trade/docs/connect/v3/exceptions/
- Angel One SmartAPI market data modes and published rate limits: https://smartapi.angelone.in/docs/MarketData
- Angel One historical candles: https://smartapi.angelone.in/docs/ResponseStructure
- Dhan live market feed: https://dhanhq.co/docs/v2/live-market-feed/
- Dhan 20/200-level depth: https://dhanhq.co/docs/v2/full-market-depth/
- Dhan historical data: https://dhanhq.co/docs/v2/historical-data/
- FYERS WebSocket capabilities and plan limits: https://fyers.in/api-docs/v3/api/websockets/websocket-overview/
- FYERS rate limits: https://support.fyers.in/portal/en/kb/articles/what-are-the-fyers-api-rate-limits-for-standard-and-prime-plans
- FYERS API terms (express prohibition on paper/virtual trading use of exchange data): https://fyers.in/terms-and-conditions-api
- Dhan support: live market data with virtual-fund paper trading is not supported: https://dhan.co/support/platforms/dhanhq-api/can-i-test-my-trading-strategy-with-virtual-money-before-going-live/
- Kite Connect terms (live market data may not be used for virtual/mock trading apps): https://www.kite.trade/terms/
- NSE data products and sharing policy: https://www.nseindia.in/static/market-data/nse-data-policy

A capability shown above is a documentation finding, not confirmation that a particular user account has the required subscription, exchange segment, market-data permission, or redistribution rights. Re-verify official documentation and provider terms before each adapter release. A provider with a documented quote or WebSocket API is not automatically eligible for this app's paper-trading use case.

## Critical SEBI / NSE restriction

The SEBI circular dated 8 May 2026, applicable from 1 July 2026, modifies the earlier real-time price-data sharing rules. For investor education and awareness activities, the circular prescribes a 30-day lag for both sharing and usage, with a one-day lag specifically for NISM's simulation lab. It also requires an appropriate legal agreement and an audit trail. It states that the preceding 30 days' price data must not be used in educational content to indicate future prices, advice, or recommendations.

Official source: https://www.sebi.gov.in/legal/circulars/may-2026/norms-for-sharing-and-usage-of-price-data-for-educational-purposes_101293.html

The 2024 SEBI circular separately restricts sharing real-time price data with third parties except for orderly market functioning or regulatory requirements. NSE's data policy requires a relevant agreement defining use and restrictions, and restricts redistribution except as agreed.

This is a release-blocking legal question for a retail paper-trading simulator using live prices. Do not assume that per-user broker OAuth makes the simulator use permissible, or that a provider's API permission overrides exchange/SEBI restrictions. Indian securities counsel and the relevant provider/exchange must confirm the exact product, user flow, purpose, distribution, and data rights in writing. Until then:
- no public live feed;
- no live-price paper fills for end users;
- no provider-to-provider live fallback for this simulator;
- no assumption that delayed data is automatically sufficient for the app's trading simulation;
- keep the existing `MARKET_DATA_RIGHTS_APPROVED` deployment gate fail-closed.

## Implementation order

1. Obtain a written legal/provider rights decision for the exact ZENURA IGNITE use case.
2. Build provider-neutral contracts and tests without enabling external credentials.
3. Implement a provider adapter only after official docs, account entitlement, terms, and rate limits are rechecked.
4. Test provider normalization, clock skew, reconnect, rate-limit handling, attribution and failover using fixtures/outage simulation.
5. Enable a provider only through server-side configuration plus a verified entitlement record.
6. Keep broker execution adapters separately disabled until separately authorized and explicitly approved by the owner.

## Adapter eligibility decision (2026-11-24)

The API-shape inventory is not an implementation authorization. The following provider decisions are now enforced by `provider-paper-trading-policy.js` and the runtime router:

- **Kite Connect — prohibited** for this product based on the express virtual/mock-trading prohibition in its published terms.
- **DhanHQ — prohibited** for live-data paper trading based on Dhan's published support answer that this use is not supported.
- **FYERS — prohibited** for paper/virtual trading based on the express prohibition in its API terms.
- **Upstox — approval required**. Existing user-scoped OAuth and feed code remains; it cannot be routed to the simulator without explicit written paper-trading and redistribution approval.
- **Angel One — approval required**. API endpoints are documented, but API documentation alone does not establish simulator or redistribution rights. No adapter is enabled.
- **Exchange-authorized vendors — contract required**. The agreement must expressly identify the paper-trading/simulation use, real-time or delayed entitlement, public display, derived data, caching, attribution, user counts, geographic scope, and onward redistribution.

The runtime requires all of: an approved provider entitlement, `paperTradingAllowed: true`, `redistributionAllowed: true`, a provider entitlement reference, and a separate written rights-approval reference. Generic broker API access is insufficient. No fallback may route around a denied provider.

Official terms reviewed:
- Kite Connect terms: https://www.kite.trade/terms/
- Dhan paper-trading support answer: https://dhan.co/support/platforms/dhanhq-api/can-i-test-my-trading-strategy-with-virtual-money-before-going-live/
- FYERS API terms: https://fyers.in/terms-and-conditions-api
- SEBI 8 May 2026 circular: https://www.sebi.gov.in/sebi_data/attachdocs/may-2026/1778242522289.pdf

This code does not activate any provider, add credentials, open a WebSocket, create real broker orders, or authorize production use.

## Additional product-level SEBI blocker

SEBI's Press Release PR No. 27/2024 dated 4 November 2024, **Advisory on unauthorized virtual trading / gaming platforms**, explicitly addresses public apps/web apps offering virtual trading or paper trading based on listed-company stock-price data and warns that such activity may violate the Securities Contracts (Regulation) Act, 1956 and SEBI Act, 1992. It reiterates that public investment/trading activity must be through/with registered intermediaries and that SEBI/exchange investor grievance protections are unavailable for unauthorized platforms.

Official source: https://www.sebi.gov.in/sebi_data/attachdocs/may-2025/1746683724445.pdf

Therefore, a signed data licence alone is not sufficient. The entire S-TRADE product model and user distribution must be reviewed by qualified Indian securities counsel, and any required regulatory, exchange and provider approvals must be obtained in writing. The 30-day educational-data lag in the 8 May 2026 circular is not an automatic safe harbour or general permission for a public paper-trading platform.

The deployment and runtime gate now requires both:
- written market-data provider/exchange rights (`MARKET_DATA_RIGHTS_APPROVED` + reference); and
- separate securities-law/regulatory clearance (`MARKET_DATA_REGULATORY_APPROVED` + reference).

Neither may be populated with placeholder values. Until both are genuinely approved, all Upstox data retrieval and paper fills remain disabled at the active gateway token boundary.

## Adapter implementation status (2026-11-24 follow-up)

Added `market-gateway/lib/provider-market-data-adapters.js`:
- `createUpstoxMarketDataAdapter` normalizes documented V3 full-quote snapshots, historical candle rows, top-of-book/depth, instrument-master rows, health and an injected closable stream transport.
- `createAngelOneMarketDataAdapter` normalizes documented SmartAPI FULL quote snapshots, IST exchange timestamps, historical OHLC candle arrays, best-five depth, instrument-master rows, health and an injected closable stream transport.
- Both adapters require injected transport functions and a provider-specific instrument resolver. They do not read credentials, construct URLs, perform OAuth, connect to a socket, or enable market data.
- Both reject malformed envelopes, invalid/future/stale timestamps, invalid paise/quantity values, unsorted or crossed depth, and malformed OHLC candles. They preserve provider attribution and entitlement references.
- Router integration tests exercise quote, candles, depth, instrument master and stream handle through the common router, including the independent entitlement gate.

### Important incomplete integration
The adapter factories are not yet instantiated by the active Supabase gateway. Production transport clients, provider-scoped OAuth/token lifecycle, Upstox protobuf-to-normalized stream event mapping, Angel One binary WebSocket decoder, stream heartbeat/reconnect/subscription handling, and the database-backed entitlement resolver must be completed and reviewed before any route can use these adapters. The current active gateway remains Upstox-specific and is protected by the dual legal/data-rights runtime gate. No live provider is enabled.

Official API-shape references rechecked:
- Upstox V3 Full Market Quotes: https://upstox.com/developer/api-documentation/get-full-market-quote-v3/
- Upstox V3 WebSocket feed (Protobuf, LTPC, Full 5-level and Full D30): https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
- Angel One SmartAPI Market Data, FULL quote, depth and candle APIs: https://smartapi.angelone.in/docs/MarketData
- Angel One WebSocket Streaming 2.0 binary protocol and heartbeat: https://smartapi.angelone.in/docs/ResponseStructure

API docs verify technical payload shapes and documented API capabilities only. They do not establish permission for public simulator display or redistribution.
