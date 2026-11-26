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
