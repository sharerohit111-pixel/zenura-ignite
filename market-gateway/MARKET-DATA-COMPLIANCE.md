# Market-data licensing and SEBI release gate

**Status: public real-time market-data launch is not approved yet.** This is a compliance gate, not a conclusion that the current per-user OAuth design is prohibited.

## Why this gate exists

- SEBI's circular dated 8 May 2026, *Norms for sharing and usage of price data for educational purposes*, modifies the earlier market-data rules. It prescribes a 30-day lag for sharing and usage of market-price data for investor education and awareness activities, with a one-day exception for NISM simulation labs and an appropriate legal agreement. The circular's applicability to this specific product and its per-user broker-authorized data flow must be confirmed by qualified Indian securities counsel.
- Upstox's public API documentation provides OAuth authorization and real-time market-data endpoints. API access alone does not prove that a third-party paper-trading product has redistribution or public-display rights.
- Upstox's published terms restrict certain copying, storage, transmission, distribution and public/commercial use of its platform materials without written consent. The precise API/data-feed agreement applicable to a registered developer application must be obtained directly from Upstox.

Official references:
- [SEBI circular – 8 May 2026](https://www.sebi.gov.in/legal/circulars/may-2026/norms-for-sharing-and-usage-of-price-data-for-educational-purposes_101293.html)
- [SEBI circular PDF](https://www.sebi.gov.in/sebi_data/attachdocs/may-2026/1778242522289.pdf)
- [Upstox API overview](https://upstox.com/developer/api-documentation/)
- [Upstox OAuth authentication](https://upstox.com/developer/api-documentation/authentication/)
- [Upstox Market Data Feed V3](https://upstox.com/developer/api-documentation/v3/get-market-data-feed/)
- [Upstox Terms of Use](https://upstox.com/terms-of-use-and-privacy-policy/)

## Current product architecture safeguards

- Every app user authenticates independently with Supabase Auth.
- Each user must independently authorize their own Upstox account through OAuth.
- The gateway resolves the Upstox token only for the authenticated Supabase user; it does not use a shared customer token.
- Quotes and candle requests are made in that user's context. Live quote responses are not stored in a shared cross-user cache.
- Paper orders are virtual only. No Upstox order-placement endpoint is used.
- Service-role credentials and Upstox client secrets remain server-side.
- The instrument master is used for instrument identity and contract metadata; it is not treated as a licensed substitute for market-price data.

These safeguards reduce accidental cross-user sharing but do **not** replace written provider permission or regulatory review.

## Required before public production deployment

1. Obtain written confirmation from Upstox Developer/Compliance that this exact use case is permitted: each end user authorizes their own Upstox account; the app displays that user's data in a paper-trading simulator; no market data is shared between users or sold.
2. Obtain any required exchange/vendor data licence, agreement, display permissions, attribution requirements and user limits.
3. Have Indian securities counsel confirm whether the app's paper-trading/investor-education functionality falls within the 30-day-lag framework or another permitted category.
4. If real-time public display is not approved, use an appropriately licensed source or implement the required delayed-data mode before launch.
5. Record the written approval reference in GitHub Actions variable `MARKET_DATA_RIGHTS_REFERENCE` and set `MARKET_DATA_RIGHTS_APPROVED=true` only after approval is actually received.

The production deployment workflow fails closed unless both GitHub variables are present and approved. Do not bypass this gate to make the app appear live.

## Additional provider-specific restrictions (reviewed 2026-11-24)

The runtime policy in `market-gateway/lib/provider-paper-trading-policy.js` now distinguishes generic API access from permission to supply market data to this app's paper-trading simulator:

- Kite Connect terms expressly prohibit use of live market data for virtual/mock trading apps. It is not an eligible fallback.
- Dhan's own support guidance says paper trading with virtual funds and live market data is not supported. Its sandbox is not a live-market simulator.
- FYERS API terms expressly prohibit using exchange data to develop paper-trading, gaming, and virtual-trading tools; they also require written consent for certain third-party copying, caching, public display and redistribution.
- Upstox and Angel One remain approval-required, not approved. API docs establish technical endpoints only.
- Any authorized vendor must provide a signed agreement expressly covering S-TRADE's simulator use, live/delayed data, display, redistribution, derived data, storage/cache, user limits, attribution, and term.

Official sources:
- Kite Connect terms: https://www.kite.trade/terms/
- Dhan support on live data + virtual funds: https://dhan.co/support/platforms/dhanhq-api/can-i-test-my-trading-strategy-with-virtual-money-before-going-live/
- Dhan sandbox clarification: https://blog.dhan.co/support/platforms/dhanhq-api/can-i-use-dhanhq-sandbox-for-paper-trading-with-virtual-money-and-live-market-data/
- FYERS API terms: https://fyers.in/terms-and-conditions-api

## Runtime enforcement

A route is denied unless the provider policy allows conditional approval and the authenticated entitlement resolver returns all of:
- `approved: true`
- `paperTradingAllowed: true`
- `redistributionAllowed: true`
- a non-empty account entitlement `reference`
- a separate non-empty written `rightsApprovalReference`

The Kite, Dhan and FYERS policy entries are hard-denied. Unknown providers are unreviewed and fail closed. A fallback provider must pass the same policy independently; failure of one provider never authorizes another.

## SEBI advisory on unauthorized virtual trading / gaming platforms

SEBI Press Release PR No. 27/2024 dated 4 November 2024 is titled **"Advisory on unauthorized virtual trading / gaming platforms"**. It specifically refers to apps and web applications offering virtual trading, paper trading, or fantasy games to the public based on listed-company stock-price data, warns that such activities may violate the Securities Contracts (Regulation) Act, 1956 and SEBI Act, 1992, and reiterates that public investing/trading activities must be through/with registered intermediaries. It also warns that SEBI/exchange investor-protection and grievance mechanisms are unavailable for unauthorized platforms.

Official SEBI press release: https://www.sebi.gov.in/sebi_data/attachdocs/may-2025/1746683724445.pdf

This is a material product-level legal blocker, not merely a feed-licensing issue. Do not infer that a no-cash virtual simulator, a disclaimer, per-user broker OAuth, a delayed feed, or a provider API agreement alone resolves the advisory. Qualified Indian securities counsel must determine the product's legal status, whether any registration/association/approval is required, and whether the proposed features and distribution model are permissible. Obtain written advice and any required regulator/exchange/provider permissions before any public simulator launch.

## Separate runtime release approvals

The active gateway now requires two distinct deployment approvals:
1. `MARKET_DATA_RIGHTS_APPROVED=true` plus `MARKET_DATA_RIGHTS_REFERENCE`: written provider/exchange rights for this exact product and data use.
2. `MARKET_DATA_REGULATORY_APPROVED=true` plus `MARKET_DATA_REGULATORY_REFERENCE`: separate documented securities-law/regulatory clearance for the public paper-trading product.

Both references are passed into the Cloud Run runtime and checked on the shared Upstox market-data token accessor. Missing either approval fails closed. This runtime gate is not a legal opinion and must not be populated with placeholder references.
