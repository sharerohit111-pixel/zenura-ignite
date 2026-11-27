# Chat 93 — statutory rounding and DP aggregation foundation

Date: 2026-11-27
Branch: fix/chat93-statutory-rounding-foundation-2026-11-27
Base: audit Chat 93 report commit 7c78b42b8a0116479b0a505d5e5e174c9c4a0611

## Scope
This change adds isolated exact-arithmetic statutory rounding primitives and a broker-specific DP charge aggregation utility. Neither helper is wired into existing order/charge calculation paths. Wiring is blocked until authoritative aggregation identity, order/ledger lifecycle, and broker contract-note comparisons are available.

## Legal and broker basis
- STT Rules, 2004, rule 4: taxable securities transaction value and STT amount are rounded to nearest rupee; 50 paise or more rounds up.
- CGST Act, 2017, section 170: tax/other sums payable under the Act are rounded to nearest rupee; 50 paise or more rounds up.
- NSE STT reporting exposes end-of-day totals, trading-member/client liabilities, and contract-level details. The app must not invent a per-fill or cross-contract aggregation rule; exact segment methodology must be reproduced from exchange computation and broker contract notes.
- Upstox's published DP tariff is ₹20 per scrip per day on delivery sells. This helper groups by account, ISIN and trade date to avoid charging once per fill/order.
- Upstox's published GST base is brokerage + transaction charges + demat/DP charges + IPFT where applicable. SEBI turnover fee is not listed in that GST base. Existing code excluding SEBI fee from its GST base is therefore consistent with the published Upstox schedule; do not add SEBI to GST base without a different broker tariff.

## Files added
- market-gateway/lib/statutory-rounding.js
- market-gateway/test/statutory-rounding.test.js
- market-gateway/lib/dp-charge-aggregation.js
- market-gateway/test/dp-charge-aggregation.test.js
- market-gateway/lib/derivative-stt-aggregation.js
- market-gateway/test/derivative-stt-aggregation.test.js

## Helper behavior
- BigInt half-up ratio rounding without binary floating point.
- Convert a non-negative integer-paise amount to nearest rupee.
- Aggregate paise values before nearest-rupee rounding; caller must choose the legally correct grouping.
- Calculate percentage tax from an already aggregated integer-paise base using an exact ratio.
- DP utility groups delivery SELL executions by accountId + ISIN + tradeDate and charges one configurable DP fee per group.
- Derivative STT utility aggregates F&O sell/exercise events by clientId + contractId + tradeDate + eventType before statutory rounding.
- F&O event bases: futures sell = actual traded value; options sell = premium; option exercise = intrinsic value.
- Rates implemented only for dates 2026-04-01 through 2026-11-27: futures sell 0.05%; options sell 0.15%; option exercise purchaser 0.15%.
- Duplicate event IDs, unsupported historical/future dates, unknown event types and physical-delivery STT fail closed.
- All helpers fail closed on invalid identities, dates, negative values, unsafe integers and overflow.

## Critical limitations
1. The generic statutory rounding helper does not choose the legal STT or GST aggregation key. The derivative STT helper implements NSE Clearing's F&O client/contract/day aggregation guidance, but still requires comparison with actual NSE STT reports and broker contract notes before integration.
2. Cash-equity STT aggregation is not implemented; it requires the cash-market security/client/settlement methodology and delivery/netting classification.
3. Physical settlement STT on stock derivatives is deliberately rejected. It requires settlement quantity/value and delivery-side classification; NSE says 0.10% applies to both receiver and giver and is computed separately from capital-market STT.
4. Derivative rate schedule is only configured for 2026-04-01 through 2026-11-27. Older and later dates fail closed until a versioned official rate master is added.
5. DP aggregation is broker-specific and currently uses the published ₹20 tariff as its default. It must not be used for another broker without a matching tariff configuration.
6. No helper is wired to order execution, ledger, wallet, portfolio or API responses. Existing charge calculators remain unchanged and are NOT certified by these additions.
7. Existing per-fill paise calculations must not be blindly replaced with per-fill rupee rounding.
8. These tests are not end-to-end statutory charge vectors or broker contract-note certification.

## Local validation
Node built-in test runner:
- Statutory rounding + DP aggregation: 12 passed in the previous isolated local run.
- Derivative F&O STT aggregation: 11 passed, 0 failed, 0 skipped in a local scratch harness.
- GitHub exact-head CI: NOT RUN / NOT CLAIMED.
- The scratch harness was a local copy of the new STT helper logic; repository CI remains the authoritative exact-source validation.

## Authoritative references
- STT Rules, 2004, rule 4: https://indiacode.ecourtsindia.com/rules/securities-transaction-tax-rules-2004-b690fc9a/
- NSE current STT rates and taxable bases effective 2026-04-01: https://www.nseindia.in/static/products-services/equity-derivatives-securities-transaction-tax
- NSE Clearing F&O STT computation, client-code identification, client/contract/day sell aggregation, option intrinsic-value exercise STT, physical-delivery STT: https://www.nseclearing.in/clearing-settlement/equity-derivatives/securities-transaction-tax
- NSE Clearing consolidated F&O circular, Item 6.1 (2024): https://avantiscdnprodstorage.blob.core.windows.net/legalupdatedocs/31619/NSE_issued_the_Consolidated_Circular_on_FO_Segment_of_NCL_Apr292024.pdf
- STT Rules, 2004 Rule 4: https://www.sebi.gov.in/sebi_data/attachdocs/apr-2017/1492087548939.pdf
- CGST Act, section 170: https://cbic-gst.gov.in/hindi/CGST-bill-e.html
- Upstox GST base, DP charge and tariff: https://upstox.com/brokerage-charges/

## Safety
No existing charge calculator, API route, order path, database, migration, deployment workflow, production data, broker connection or Crypto file changed. Draft only; do not merge or deploy.