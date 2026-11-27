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

SEBI Press Release PR No. 37/2024 dated 4 November 2024 is titled **"Advisory on unauthorized virtual trading / gaming platforms"**. It specifically refers to apps and web applications offering virtual trading, paper trading, or fantasy games to the public based on listed-company stock-price data, warns that such activities may violate the Securities Contracts (Regulation) Act, 1956 and SEBI Act, 1992, and reiterates that public investing/trading activities must be through/with registered intermediaries. It also warns that SEBI/exchange investor-protection and grievance mechanisms are unavailable for unauthorized platforms.

Official SEBI press release: https://www.sebi.gov.in/media-and-notifications/press-releases/nov-2024/advisory-on-unauthorized-virtual-trading-gaming-platforms_88200.html

This is a material product-level legal blocker, not merely a feed-licensing issue. Do not infer that a no-cash virtual simulator, a disclaimer, per-user broker OAuth, a delayed feed, or a provider API agreement alone resolves the advisory. Qualified Indian securities counsel must determine the product's legal status, whether any registration/association/approval is required, and whether the proposed features and distribution model are permissible. Obtain written advice and any required regulator/exchange/provider permissions before any public simulator launch.

## Separate runtime release approvals

The active gateway now requires two distinct deployment approvals:
1. `MARKET_DATA_RIGHTS_APPROVED=true` plus `MARKET_DATA_RIGHTS_REFERENCE`: written provider/exchange rights for this exact product and data use.
2. `MARKET_DATA_REGULATORY_APPROVED=true` plus `MARKET_DATA_REGULATORY_REFERENCE`: separate documented securities-law/regulatory clearance for the public paper-trading product.

Both references are passed into the Cloud Run runtime and checked on the shared Upstox market-data token accessor. Missing either approval fails closed. This runtime gate is not a legal opinion and must not be populated with placeholder references.

## Indian exchange distribution, delayed-data and storage boundaries (reviewed 2026-11-26)

This section is a conservative engineering release policy, not a legal opinion.

### SEBI chronology and operative date

- **24 May 2024 — SEBI/HO/MRD/MRD-PoD-3/P/CIR/2024/56.** SEBI restricted sharing of real-time price data by market infrastructure institutions (MIIs) and registered intermediaries with third parties, subject to the stated orderly-market / regulatory exceptions. The circular's educational sharing provision was later amended. Official: https://www.sebi.gov.in/legal/circulars/may-2024/norms-for-sharing-of-real-time-price-data-to-third-parties_83572.html
- **29 January 2025 — SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2025/11.** This circular is titled *Details/clarifications on provisions related to association of persons regulated by the Board, MIIs, and their agents with persons engaged in prohibited activities*. Its FAQ 8, as amended by the 2026 circular, describes the boundary between education and advice/recommendation. Do not misdescribe the 2025 circular as a standalone market-data licensing circular. Official: https://www.sebi.gov.in/legal/circulars/jan-2025/details-clarifications-on-provisions-related-to-association-of-persons-regulated-by-the-board-miis-and-their-agents-with-persons-engaged-in-prohibited-activities_91356.html
- **8 May 2026 — HO/47/17/12(11)2025-MRD-POD3/I/11107/2026.** The circular changes educational/awareness price-data sharing and usage to a 30-day lag and provides a one-day lag solely for NISM's simulation lab. Paragraph 7 states applicability **with effect from 1 July 2026**. Paragraph 6.1 requires an appropriate legal agreement and safeguards/audit-trail obligations. Official PDF: https://www.sebi.gov.in/sebi_data/attachdocs/may-2026/1778242522289.pdf
- **4 November 2024 — SEBI PR No. 37/2024** (not PR No. 27/2024). SEBI specifically cautions about public virtual-trading/paper-trading/fantasy platforms based on listed-company stock-price data. Official: https://www.sebi.gov.in/media-and-notifications/press-releases/nov-2024/advisory-on-unauthorized-virtual-trading-gaming-platforms_88200.html

The 30-day educational provision is not a general-purpose market-data licence, does not itself authorize a trading simulator, and does not override provider/exchange contracts or the separate product-level legal issue raised by the virtual-trading advisory. NISM's one-day simulation-lab exception is specific to NISM and must not be represented as available to ZENURA IGNITE. No monetary incentives may be offered under the educational sharing provision. Counsel must assess whether a product that simulates trades, displays price-driven P&L, ranking, signals or recommendations is genuinely within the permitted education/awareness activity at all.

### NSE requirements

NSE/NSE Data & Analytics' Data Sharing & Usage Policy governs use, sharing, distribution, redistribution, dissemination, display and monitoring. The policy defines Market Data broadly to include streaming, real-time, snapshot, delayed, end-of-day, historical and corporate data, as well as securities/derivatives identifiers, prices, volumes and trade-related data. A subscriber must execute the relevant agreement setting out intended use and how data may be received, transmitted, handled and disseminated. Redistribution is not permitted except as agreed. Agreements can impose end-user restrictions, recordkeeping and audit/inspection rights. Commercial access is subject to applicable charges. Official policy: https://www.nseindia.in/static/market-data/nse-data-policy

NSE's published product information separately lists real-time data, snapshot feeds and 15-minute delayed snapshots; it notes that website and app display are separate display media for tariff purposes. Its delayed-feed tariff notice says vendors supplying delayed data as a feed to clients for any type of use require written consent from NSE Data & Analytics. Therefore a 15-minute, 30-minute, EOD or other delayed label does not eliminate the need for the relevant licence and downstream permissions. Official product page: https://www.nse.in/static/market-data/real-time-data-subscription and tariff notice: https://nsearchives.nseindia.com/web/sites/default/files/inline-files/Download15mindelayeddatatariff.pdf

NSE Circular NSE/COMP/56426 dated 20 April 2023 also advised trading members that NSE data is for legitimate trading purposes by their clients and not gaming or virtual trading. Official: https://archives.nseindia.com/content/circulars/COMP56426.pdf

### BSE requirements and vendor chain

BSE's official market-data portal lists EOD/reference and delayed-data products and requires registration/KYC, plan selection, agreement and payment before access: https://marketdata.bseindia.com/. BSE's published Information Products tariff sheet identifies real-time, intraday snapshot/delayed, EOD, historical and corporate data products and names websites and mobile-app developers among customer categories; this is evidence of a formal product/licensing route, not an open public-feed permission: https://www.bseindia.com/downloads1/Information_Products_Pricing_Sheet.pdf.

For international BSE Information Products, Deutsche Börse Market Data + Services states it is the exclusive licensor and requires a Market Data Dissemination Agreement for electronic dissemination. Applicability depends on territory/product; confirm the correct licensing counterparty for an India-based product directly with BSE and/or its appointed licensor: https://www.mds.deutsche-boerse.com/mds-en/real-time-data/asian-markets/BSE-India-Spot-Market-1340020.

### Feed classes — conservative release treatment

| Data class | Release treatment |
|---|---|
| Real-time / streaming / tick / quotes / depth | Disabled. Requires specific source entitlement and written permission for third-party app display, paper-simulator use and redistribution, plus counsel's product-level clearance. SEBI's 2024 restriction is a separate issue. |
| Delayed / snapshot (including 15-minute) | Not automatically free or permitted. Obtain the exact feed licence, downstream client-feed/display permission and user/device/app scope. The 30-day educational provision is not a general simulator exemption. |
| 30-day delayed educational price data | Potentially usable only if counsel confirms the product is truly within the education/awareness route, no monetary incentives are offered, the source agrees to share it, and required legal agreement, controls and audit trail exist. This is not pre-approved for S-TRADE. |
| NISM one-day simulation-lab data | Exception is specific to NISM's simulation lab; unavailable as a general S-TRADE permission. |
| End-of-day / historical / reference / corporate data | Still Market Data under NSE's policy definition. Obtain product-specific rights for storage, historical replay, display, redistribution and derived outputs. Do not assume old data is public domain. |
| Synthetic data | May be used for development/demo only when generated independently (e.g. seeded simulator prices), not copied, transformed, delayed, sampled, reverse-engineered or calibrated from restricted live/vendor/exchange data. Keep provenance proving synthetic generation; do not label vendor-derived data synthetic. This does not resolve product-level SEBI questions if the app is publicly promoted as virtual trading. |

### Vendor and provider evidence

- Upstox: API docs establish technical OAuth/feed capability, not S-TRADE redistribution or paper-simulator rights. Obtain signed written confirmation from Upstox compliance/developer relations and any upstream exchange approval/permission that the contract requires.
- Angel One: API docs likewise do not establish third-party simulator/display rights. Obtain signed product-specific permission and upstream exchange rights.
- Kite Connect: published terms prohibit use of live market data for virtual/mock trading apps; keep hard-denied unless Kite issues an express signed override applicable to this exact product.
- Dhan: published support guidance says paper trading with virtual funds and live market data is not supported; keep hard-denied unless an express signed change is obtained.
- FYERS: published API terms prohibit use of exchange data for paper/virtual trading tools; keep hard-denied unless an express signed override applies.
- Any intermediary vendor: verify that it is authorized for the exact exchange, segment, product and territory, and that its upstream contract permits onward distribution to this app and its end users. A vendor's own API key or subscription is not enough.

### Required contract schedule / permissions

Written agreements must expressly state, as applicable: (1) S-TRADE/ZENURA IGNITE as named product and operator; (2) paper-trading/simulation purpose; (3) exact exchanges, segments, instruments and data fields; (4) real-time, delayed, EOD and historical entitlements and permitted delay; (5) app/web/mobile display media and public/private user groups; (6) number/type/territory of end users, devices and concurrent sessions; (7) redistribution/downstream access and whether end-user accounts need individual entitlements; (8) caching, persistence, historical retention, backups and deletion after termination; (9) derived data, calculations, virtual fills, P&L, charts, alerts and exports; (10) required attribution, logos, disclaimers and update frequency; (11) fees, reporting, audit logs, inspections and usage reports; (12) security, breach notification, subcontractors and data location; (13) term, termination, revocation and feed shutdown; and (14) upstream exchange/data-owner approvals and any sublicensing chain.

Do not infer a universal attribution phrase. Follow the exact wording, prominence, placement and logo rules in each executed agreement. If attribution is unspecified, obtain written clarification before display.

### Storage and access controls

- No shared cache, public endpoint, browser bundle, CDN object, export, chart image, notification, analytics event or log may expose licensed price data unless the contract expressly permits that channel and audience.
- Keep user-scoped entitlements and data segregation; enforce entitlement at the server boundary, not only in the UI.
- Store only fields and durations permitted by the agreement; encrypt retained data, restrict service-role access, log reads/exports where required, and support expiry/deletion on revocation or contract termination.
- Do not persist provider raw payloads, ticks, depth, candles, instrument masters or derived series merely because a database/cache is available. Each class needs a documented retention right.
- Review instrument-master/reference data separately. The /instruments route is now protected by Supabase authentication, both documentary approval gates, and private, no-store responses; instrument-master refreshes also require both gates before download/retention. This is an engineering containment measure, not proof of redistribution rights. Obtain written permission covering instrument identifiers/reference fields, caching, display and user access before enabling the gates for this route.

### Runtime and release gate

MARKET_DATA_RIGHTS_APPROVED=true plus a real MARKET_DATA_RIGHTS_REFERENCE is necessary but not sufficient. MARKET_DATA_REGULATORY_APPROVED=true plus a real MARKET_DATA_REGULATORY_REFERENCE is also mandatory. References must identify signed, retrievable documentary evidence; a ticket number, placeholder, API key, self-attestation or this document is not approval. Approval must cover the specific source, data class, use, distribution channel, users, retention and attribution. Revocation/expiry must turn the relevant source off. No feed mode (live, delayed, EOD, historical, educational or NISM-labelled) may bypass the two gates. Synthetic mode must be independently sourced and must never be a disguise for a licensed feed.

### Release approval checklist

1. Qualified Indian securities counsel's signed opinion on whether this public paper-trading product and its marketing/features are permissible, whether any SEBI registration/association/intermediary status or other permission is required, and whether any educational-data provision applies.
2. Written Upstox approval (if used) or Angel One approval (if used) specifically for third-party public paper-trading simulation, display, redistribution, derived outputs and end-user model; otherwise written contract with an authorized NSE/BSE vendor covering the same.
3. Written upstream NSE and/or BSE permissions or vendor chain evidence for each exchange/segment and product, including downstream distribution rights; do not infer from a broker retail account.
4. Signed data licence schedule covering live/delayed/EOD/historical/reference data, channels, user/device limits, geography, retention, caching, derived data, attribution, fees, audit and termination.
5. Written confirmation of required attribution wording, display placement and brand/logo usage.
6. Approved data-retention, deletion, revocation, access-control, audit-trail and incident-response controls mapped to the licence.
7. Independent compliance verification that both release gates are backed by signed documents and are enforced by every data path, including instrument/reference data routes.
8. Exact-head CI passing, including fail-closed tests; no production deployment or provider activation is part of this task.

**Release status remains BLOCKED** until all applicable items are complete and reviewed. This checklist does not constitute legal advice or legal approval.


## Critical NSE policy blocker — Clause 7.4 (explicitly recorded 2026-11-27)

The consolidated NSE / NSE Data Sharing & Usage Policy contains an express restriction in **Clause 7.4**: Market Data shall not be provided to individuals, entities, platforms, apps or websites engaging in online gaming, virtual trading or simulation, fantasy games, similar activities, or activities prohibited by applicable law/regulator/government/judicial authority. Clause 7.3 separately prohibits redistribution except as agreed in the Relevant Agreement. The policy defines Market Data broadly, including streaming, real-time, snapshot, delayed, end-of-day, historical and corporate data, as well as securities/derivatives identifiers, prices, volumes and trade-related data.

Official primary source (consolidated policy PDF): https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_Data_Sharing%26Usage_Policy.pdf
Official NSE policy page: https://www.nseindia.in/static/market-data/nse-data-policy

**S-TRADE impact:** S-TRADE is designed as a paper/virtual trading simulator. On the face of Clause 7.4, NSE Market Data must therefore remain blocked for this product unless NSE provides a written, product-specific clarification/authorization that is legally available under the policy and applicable SEBI directions, and qualified Indian securities counsel confirms the permitted scope. Do not assume that an ordinary market-data subscription, a broker retail API/OAuth entitlement, a vendor contract, a 15-minute/30-day delay, an EOD/historical label, or an educational/NISM label overrides Clause 7.4. This document does not assert that an exception exists.

The separate NSE circular **NSE/COMP/56426 dated 20 April 2023** advised trading members to use NSE data for legitimate trading purposes by clients and not for gaming or virtual trading. Treat that circular as additional context; the direct product/data restriction recorded above is Clause 7.4 of the consolidated Data Sharing & Usage Policy. Official circular: https://nsearchives.nseindia.com/content/circulars/COMP56426.pdf

**Required release disposition:** NSE-sourced data for S-TRADE remains **BLOCKED**. Obtain (1) written NSE/NSE Data legal/compliance clarification naming ZENURA IGNITE S-TRADE and its exact simulation use, data classes, channels and end-user model; (2) evidence that the proposed permission is consistent with Clause 7.4 and current SEBI directions; and (3) a signed opinion from qualified Indian securities counsel. If NSE confirms that the proposed use is not permitted, do not use NSE data; redesign around independently generated synthetic data or another legally cleared route, subject to separate product-level legal review. Never activate NSE feed flags while this blocker is unresolved.


## Explicit display entitlement hardening (2026-11-27)

A provider/user entitlement is not eligible for paper-trading market-data routing unless it independently includes `displayAllowed: true` in addition to paper-trading and redistribution permissions. A generic API entitlement, a redistribution-only permission, or a display-only permission is insufficient. Missing display permission fails closed before any provider adapter is called. This is a technical enforcement requirement; the underlying signed agreement must still be inspected by compliance personnel.
