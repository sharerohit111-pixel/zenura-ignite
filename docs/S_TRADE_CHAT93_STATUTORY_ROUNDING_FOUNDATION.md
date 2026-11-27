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

## Helper behavior
- BigInt half-up ratio rounding without binary floating point.
- Convert a non-negative integer-paise amount to nearest rupee.
- Aggregate paise values before nearest-rupee rounding; caller must choose the legally correct grouping.
- Calculate percentage tax from an already aggregated integer-paise base using an exact ratio.
- DP utility groups delivery SELL executions by accountId + ISIN + tradeDate and charges one configurable DP fee per group.
- All helpers fail closed on invalid identities, dates, negative values, unsafe integers and overflow.

## Critical limitations
1. The statutory rounding helper does not choose the legal STT or GST aggregation key. Do not infer the correct key from these generic utilities.
2. DP aggregation is broker-specific and currently uses the published ₹20 tariff as its default. It must not be used for another broker without a matching tariff configuration.
3. Neither helper is wired to order execution, ledger, wallet, portfolio or API responses. Existing charge calculators remain unchanged and are NOT certified by these additions.
4. Existing per-fill paise calculations must not be blindly replaced with per-fill rupee rounding.
5. The generic rounding tests and DP aggregation tests are not end-to-end statutory charge vectors or broker contract-note certification.

## Local validation
Node built-in test runner against the isolated helper/test files:
- Tests: 12
- Passed: 12
- Failed: 0
- Skipped: 0

This is local unit evidence only. GitHub exact-head CI has not run and is not claimed.

## Authoritative references
- STT Rules, 2004, rule 4: https://indiacode.ecourtsindia.com/rules/securities-transaction-tax-rules-2004-b690fc9a/
- NSE STT computation and end-of-day reporting: https://www.nseindia.in/static/products-services/equity-derivatives-securities-transaction-tax
- CGST Act, section 170: https://cbic-gst.gov.in/hindi/CGST-bill-e.html
- Upstox GST base, DP charge and tariff: https://upstox.com/brokerage-charges/

## Safety
No existing charge calculator, API route, order path, database, migration, deployment workflow, production data, broker connection or Crypto file changed. Draft only; do not merge or deploy.