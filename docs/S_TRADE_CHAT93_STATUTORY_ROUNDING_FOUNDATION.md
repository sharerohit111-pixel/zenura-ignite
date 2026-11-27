# Chat 93 — statutory rounding foundation

Date: 2026-11-27
Branch: fix/chat93-statutory-rounding-foundation-2026-11-27
Base: audit Chat 93 report commit 7c78b42b8a0116479b0a505d5e5e174c9c4a0611

## Scope
This change adds isolated exact-arithmetic primitives and golden vectors for nearest-rupee rounding. It does NOT wire them into live/paper charge calculators. Wiring must wait until the applicable statutory and exchange aggregation boundaries are established and contract-note comparisons exist.

## Legal/operational basis
- Securities Transaction Tax Rules, 2004, rule 4: taxable securities transaction value and STT amount are rounded to nearest rupee; 50 paise or more rounds up.
- CGST Act, 2017, section 170: tax/other sums payable under the Act are rounded to nearest rupee; 50 paise or more rounds up.
- NSE Clearing's STT computation page says STT is determined at end of each trading day; member liability aggregates client liabilities, and client liability is based on exchange's detailed client-wise computation.
- NSE Clearing's historical cash STT methodology describes client-level aggregation across securities/settlements before final nearest-rupee rounding. Exact current segment-specific calculation must follow current circulars and broker contract notes, not a generic helper assumption.

## Files added
- market-gateway/lib/statutory-rounding.js
- market-gateway/test/statutory-rounding.test.js

## Helper behavior
- BigInt half-up ratio rounding; no binary floating point.
- Convert a non-negative integer-paise amount to nearest rupee.
- Sum a non-empty set of paise amounts before nearest-rupee rounding.
- Calculate a percentage tax from an already aggregated integer-paise base using an exact integer ratio, then round payable amount to rupees.
- Fail closed on invalid/negative/unsafe values.

## Critical limitations
1. Aggregation key is intentionally not selected by this module. Caller must establish the correct legal key (for example client/security/settlement/trading day for STT where the applicable NSE methodology requires it, or the appropriate GST amount payable boundary).
2. This module does not calculate STT taxable value, determine transaction classifications, resolve exchange/broker rates, split CGST/SGST/IGST, or model GST invoice/return reconciliation.
3. Existing charge calculators remain unchanged and are NOT yet compliant/certified by virtue of this helper.
4. The existing per-fill charge rounding must not be replaced blindly with a per-fill rupee round; that could materially overstate or understate aggregated liability.
5. Golden vectors here test only the generic nearest-rupee arithmetic. They are not end-to-end statutory charge vectors or broker contract-note certification.

## Local validation
Node built-in test runner against the new helper/test content:
- Tests: 7
- Passed: 7
- Failed: 0
- Skipped: 0

This is local unit evidence only. GitHub exact-head CI has not run and is not claimed.

## Authoritative references
- STT Rules, 2004, rule 4: https://indiacode.ecourtsindia.com/rules/securities-transaction-tax-rules-2004-b690fc9a/
- NSE Clearing STT computation: https://www.nseclearing.in/clearing-settlement/equity-derivatives/securities-transaction-tax
- NSE Clearing cash-market STT methodology: https://www.nseclearing.in/equities
- CGST Act, section 170: https://cbic-gst.gov.in/hindi/CGST-bill-e.html

## Safety
No existing charge calculator, API route, order path, database, migration, deployment workflow, production data, broker connection or Crypto file changed. Draft only; do not merge or deploy.