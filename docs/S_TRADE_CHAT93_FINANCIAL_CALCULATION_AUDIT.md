# S-TRADE Chat 93 — Indian-market financial calculation audit

Audit date: 2026-11-27
Repository: sharerohit111-pixel/zenura-ignite
Inspected ref: release/s-trade-mainline-integration-2026-11-25
Scope: brokerage, exchange fees, STT, GST, stamp duty, DP charges, F&O margin normalization, rounding and tests.
Status: NOT CERTIFIED. This is an evidence-backed source review, not a production accounting attestation.

## Safety boundary
- No production orders, deployment, merge, hosted database writes, migrations, balance changes, broker calls, or secret access were performed.
- Crypto paths were not modified.
- This branch contains audit documentation only. It does not change runtime calculations.
- Do not enable live execution or claim contract-note parity based on these results.

## Inspected source files
- market-gateway/lib/trading-charges.js (blob  bead8ab2133dfc5ad5177270af19e39508957d20)
- market-gateway/lib/margin-preview-input.js (blob e96be73bebe376a34f683c28fdeb449121e48860)
- market-gateway/lib/upstox-margin.js (blob 6a101db1f6637a50e09a4b7f869510a0f22acb25)
- market-gateway/lib/derivative-position.js (blob 84d0f7d0294d30fc3375f7b858fc15af840afd69)
- market-gateway/lib/paper-futures-limit-worker.js (blob e24e91c464f83d669dedfae2be2a15843938ce63)
- market-gateway/lib/equity-demo-execution-engine.js (blob 666a1cace77003f6879725001af1f20c546e5bf3)
- market-gateway/test/trading-charges.test.js (blob a619df800ba493ba399a8749d6a072ba3c866157)

## Confirmed findings

### F-01 — STT rounded in paise in runtime; statutory rounding is nearest rupee
Severity: HIGH
Evidence: trading-charges.js applies roundPaise(grossPaise * rate) independently to STT for Equity, Futures and Options. Securities Transaction Tax Rules, 2004 rule 4 prescribe rounding the taxable transaction value and STT to the nearest rupee (50 paise rounds up). NSE Clearing also describes client/member aggregation of STT liabilities. Current tests assert paise results (e.g. 146 paise for an option sell and 50,000 paise for a futures sell) rather than a client/day statutory rounded liability.
Impact: Displayed/posted STT can differ from statutory collection and aggregation semantics, especially across small fills/trades.
Required fix: model the correct aggregation key and settlement scope (client, exchange, segment/security/settlement as required by the applicable rules), preserve high-precision intermediate amounts, then apply rupee rounding at the prescribed stage. Do not merely round every fill independently.

### F-02 — GST is calculated and stored in paise without proving statutory invoice rounding/aggregation
Severity: HIGH
Evidence: GST is computed with Math.round(basePaise * 0.18) in every calculator. CGST Act section 170 requires tax payable under the Act to be rounded to the nearest rupee. Existing tests assert paise-level GST (e.g. 365 paise).
Impact: Tax amount may not match invoice/contract-note aggregation and statutory rounding. A component-level paise ledger may be retained internally, but the payable GST output must follow the applicable invoice/tax aggregation rule.
Required fix: distinguish internal accrual precision from final invoice/tax payable rounding; document the aggregation boundary and reconcile to broker contract notes.

### F-03 — Options exercise and physically settled derivatives STT are not represented by the charge calculator
Severity: HIGH
Evidence: calculateLongOptionTradeCharges only applies 0.15% on SELL premium. There is no exercised-option intrinsic-value STT branch. The derivative position helper reports excludesCharges:true. NSE Clearing says final exercise STT is on intrinsic value and physically settled stock derivatives attract delivery-based STT on both purchaser and seller.
Impact: Expiry/exercise/physical settlement may be financially incomplete or understated.
Required fix: add distinct lifecycle charge events for option premium sale, option exercise intrinsic value, and physical settlement of stock futures/options; verify effective date and settlement-side obligations.

### F-04 — DP fee is estimated per sell order, not per scrip per day
Severity: HIGH
Evidence: calculateEquityDeliveryCharges hardcodes dpChargesPaise=2000 on each SELL call. The source comment itself says DP is estimated per sell order and not aggregated by scrip/day. Upstox published schedule says ₹20 per scrip per day on sell.
Impact: multiple sell orders in the same scrip/day may overcharge; split fills/orders can diverge from broker billing.
Required fix: aggregate DP fee by account/client + scrip + trading/settlement day, with broker-specific schedule and applicable taxes.

### F-05 — Static rate constants are not an effective-dated rate master
Severity: HIGH
Evidence: trading-charges.js has global constants for STT, stamp duty, SEBI, GST, brokerage and exchange fees. A few returned objects expose scheduleVersion strings, but the calculation functions accept no trade date and do not select a schedule by trade timestamp. Options charge output has no scheduleVersion.
Impact: backdated trades, replay, corrections and future rate changes cannot be reliably recomputed against the applicable historical schedule.
Required fix: versioned rate master keyed by exchange, segment, product, side, broker, jurisdiction/state where relevant, effective_from/effective_to, source URL/circular and approval state. Every calculation must require trade timestamp and resolve exactly one schedule; fail closed on gaps/overlaps.

### F-06 — Broker-specific assumptions are mixed into purported market-wide financial logic
Severity: MEDIUM
Evidence: DEFAULT_BROKERAGE_PAISE=2000 and Upstox-style brokerage caps are hardcoded in a shared calculator. DP is also broker-specific. The module comments call results indicative, but shared callers can still consume them.
Impact: brokerage and DP will be wrong for users with another broker or a changed broker tariff.
Required fix: require an explicit broker tariff profile and effective date; keep statutory charges separate from broker/exchange charges; label all previews indicative until broker profile is selected.

### F-07 — Margin normalizer is not an independent SPAN/ELM calculator or proof of complete margin response
Severity: HIGH
Evidence: normalizeUpstoxMarginResponse requires required_margin and optionally maps span/exposure/option_premium/net_buy_premium/total_margin/tender/delivery if present. It accepts an empty margins array and does not require SPAN and ELM components, reconcile their sum to required_margin, or prove offsets/portfolio-level risk coverage. parseMarginPreviewInput only validates instrument, lots, side and product.
Impact: a valid-looking response can be shown without enough component evidence to explain or independently validate margin.
Required fix: distinguish provider-quoted margin from independently verified exchange margin. Preserve raw provider response provenance/time; require expected components for the selected product/contract and reconciliation to the provider total; compare to official clearing files/calculator in a disposable test fixture. Do not fabricate SPAN/ELM from fixed percentages.

### F-08 — NSE/BSE charge rules need explicit source/profile boundaries
Severity: MEDIUM
Evidence: BSE equity delivery/intraday are blocked pending scrip-group data; BSE futures transaction charge is set to zero; BSE options rate is hardcoded to 0.0325%. NSE charges are hardcoded to March 2026 schedule. These are not selected from instrument master plus effective-dated exchange circulars.
Impact: correct-looking rates can be applied to the wrong scrip group, contract, date or broker tariff.
Required fix: exchange-specific master with BSE scrip group/segment and NSE contract schedule; add effective dates and provenance; block any unmatched instrument.

### F-09 — Equity Demo engine intentionally does not model fees
Severity: MEDIUM
Evidence: equity-demo-execution-engine.js header says fees/taxes are not modelled; fixture requires meta.fees === "NOT_MODELED".
Impact: Demo equity wallet/P&L cannot be represented as net-of-charges or compared with contract-note net settlement.
Required fix: keep the explicit NOT_MODELED disclosure until a separate fee-aware demo ledger is implemented and reconciled. Do not remove the guard without golden vectors and lifecycle tests.

### F-10 — Existing tests encode paise-level STT/GST expectations and do not prove statutory golden vectors
Severity: HIGH
Evidence: trading-charges.test.js includes assertions such as option STT 146 paise, futures STT 50,000 paise, GST 365 paise and a comment that PostgreSQL floor(x + 0.5) is the rounding oracle. These are internal implementation expectations, not proof of correct statutory aggregation/rounding. No exact-head CI run was executed in this audit.
Required fix: replace/add authoritative golden vectors with trade-date, client/day aggregation, rupee-rounding boundaries, multiple partial fills, multi-order DP aggregation, option exercise, physical settlement and broker-specific tariff cases. Cross-check against independent integer/decimal reference calculations and documented exchange/broker examples.

## Rate facts verified from public primary/issuer sources (as of 2026-11-27)
- STT from 2026-04-01: Equity delivery 0.1% buyer and seller; equity intraday 0.025% seller; futures 0.05% seller; options sale 0.15% premium seller; exercised options 0.15% intrinsic value purchaser. NSE and Income Tax Department Budget 2026 FAQ sources.
- NSE transaction charges from 2026-03-01: Cash ₹307/crore/side; Equity Futures ₹183/crore/side; Equity Options ₹3,553/crore premium/side (exchange charge plus IPFT contribution). NSE circular NSE/FA/73061.
- Upstox published brokerage: delivery ₹20/executed order; intraday lower of ₹20 or 0.1%; futures lower of ₹20 or 0.05%; options ₹20/executed order. This is Upstox-specific, not a universal broker rule.
- Upstox schedule lists DP ₹20 per scrip/day on sell, BSE cash scrip-group rates, BSE Futures nil and BSE Options 0.0325%; these remain broker tariff statements and must be date/profile controlled.
- NSE Clearing states SPAN-based portfolio margining, upfront initial margin, ELM and delivery/consolidated crystallized obligations; a simple notional percentage is not a substitute for live contract/portfolio SPAN.

## CI / execution evidence
- No test suite or workflow was run in this audit turn.
- No exact-head CI result is claimed.
- No disposable PostgreSQL environment was provisioned by this documentation-only audit.
- Existing test source was inspected, not executed.
- Therefore: CI = NOT RUN; financial certification = NOT CERTIFIED.

## Authoritative references
1. NSE STT page: https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax
2. Income Tax Department Budget 2026 FAQ: https://www.incometaxindia.gov.in/documents/20117/15766092/FAQs-Budget-2026%2BUpdated.pdf
3. NSE Circular NSE/FA/73061 dated 2026-02-27 (effective 2026-03-01): https://nsearchives.nseindia.com/content/circulars/FA73061.pdf
4. NSE Clearing margins: https://www.nseclearing.in/risk-management/equity-derivatives/margins
5. NSE Clearing STT computation/settlement: https://www.nseclearing.in/clearing-settlement/equity-derivatives/securities-transaction-tax
6. Upstox brokerage charges: https://upstox.com/brokerage-charges/
7. CGST Act section 170: https://cbic-gst.gov.in/pdf/CGST-Act-Updated-01082021.pdf
8. Securities Transaction Tax Rules, 2004 rule 4: https://www.sebi.gov.in/sebi_data/attachdocs/apr-2017/1492087548939.pdf

## Recommended remediation sequence
1. Build immutable, effective-dated rate master and provenance schema.
2. Correct STT rupee rounding/aggregation and GST invoice rounding without losing internal paise precision.
3. Add exercised-option and physically-settled derivative charge events.
4. Correct DP aggregation to scrip/day and isolate broker tariffs.
5. Add BSE scrip-group/segment schedule mapping and fail-closed tests.
6. Add provider-vs-independent SPAN/ELM validation fixtures.
7. Add golden vectors and disposable PostgreSQL integration tests.
8. Run all relevant workflows on the exact final PR head; record run IDs, head SHA, failed/skipped steps and test counts.

No remediation is considered complete until its exact-head CI is green and the calculations reconcile to authoritative examples.