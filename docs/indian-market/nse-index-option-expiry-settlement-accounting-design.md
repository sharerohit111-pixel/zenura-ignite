# NSE Index Options Expiry Settlement Accounting — Design Only

Status: Draft design; no settlement posting implementation is authorized by this document.
Branch: `feature/nse-index-option-expiry-settlement-design-2026-11-23`
Baseline: PR #98 head `1617d48f2e0643e89042c63fa50f601e3bd897ec`

## 1. Scope and explicit exclusions

This design covers expiry settlement accounting for an already-open **long NSE index CE/PE** paper position whose contract master explicitly identifies it as cash-settled.

In scope:
- Freeze and eligibility checks after the verified contract expiry/session cutoff.
- Verified official settlement-price ingestion and provenance.
- Intrinsic-value payout calculation in integer paise.
- Entry cost-basis release and realized P&L.
- Versioned expiry charge schedule, immutable settlement record, idempotency, and account reconciliation.
- Atomic position close and cash/account update.

Out of scope and rejected:
- Short-option opening or short-option expiry obligations.
- NSE stock options, physical settlement, BSE options, unknown settlement types, or inferred settlement type.
- Broker/live order routing, real-money settlement, or exchange connectivity.
- Reusing a fake MARKET/SELL order to represent exercise/expiry.
- Posting from a quote, LTP, option premium, user-supplied price, or unverified source.
- Enabling production migrations or feature flags.

## 2. Audited baseline and compatibility constraints

The existing long-option MARKET transaction stores premium cash movement, charges, fee-inclusive position cost basis, and realized P&L in the account/order records. BUY entry charges are already included in `paper_derivative_positions.cost_basis_paise`. SELL-to-close releases a proportional part of that basis and subtracts exit charges.

The existing derivative valuation uses fresh quotes for open positions. The existing expiry payoff simulator is explicitly non-posting: it returns gross intrinsic payout and gross P&L before expiry charges, leaves net realized P&L null, and sets `ledgerPostingAllowed=false`.

PR #98 adds expiry-calendar fail-closed protection for outstanding LIMIT reservations and a concurrent reservation regression. This design must preserve those behaviours and the account-first lock order.

Do not change Chat 5 Order Engine files, existing MARKET/LIMIT order RPC signatures, execution workers, or short-option policy.

## 3. Settlement eligibility — fail closed

A settlement attempt is eligible only if all conditions hold:

1. Contract master record matches the position's instrument key, exchange `NSE`, segment `NSE_FO`, CE/PE type, strike, lot size, expiry date, and underlying identifier.
2. Contract master explicitly attests `underlying_type=INDEX` and `settlement_type=CASH_SETTLED`; absence, stale metadata, or conflicting sources blocks posting.
3. Position is long with positive quantity and positive fee-inclusive cost basis. Quantity must be a valid lot multiple.
4. The contract expiry date and exchange session cutoff have passed according to a verified NSE calendar/session record. Do not infer expiry completion from local wall-clock alone.
5. No PENDING/PARTIALLY_FILLED LIMIT order exists for the instrument and no close quantity/cash reservation remains. Pending orders must first reach a valid terminal state through the existing lifecycle.
6. The settlement price is the official expiry settlement reference applicable to that exact underlying and expiry date, not an option quote or arbitrary underlying LTP.
7. Settlement source evidence and the applicable charge schedule are independently authenticated, current, and effective for the settlement date.
8. The position has not already been settled, and no conflicting settlement event exists.

Any missing or ambiguous condition means **no posting and no position deletion**.

## 4. Price evidence and provenance

The upstream importer—not a client or API caller—must authenticate the NSE source and normalize the applicable settlement value. An `nseindia.com` URL and matching SHA-256 digest alone prove neither source authenticity nor that the value is the correct exchange settlement reference.

Persist or immutably reference:
- Exchange, segment, underlying identifier, expiry date, and settlement-price field name.
- Price as integer paise plus original source precision and normalization rule.
- Source URL, retrieval timestamp, source publication timestamp, raw payload object reference, SHA-256 digest, importer version, and importer verification/attestation identifier.
- Contract-master version and verified settlement/session calendar version.
- A deterministic payload fingerprint covering all fields above.

Reject future-dated evidence, expiry-date mismatches, wrong underlying identifiers, stale/unverified imports, duplicate conflicting source records, and any price that cannot be losslessly normalized to the supported paise precision. Never silently round an unsupported precision.

Raw source retention should use immutable/versioned storage with restricted writer access. The database must not trust caller-supplied `verified=true` flags.

## 5. Calculation and accounting semantics

For a long position:

- CE intrinsic per unit = `max(settlement_price_paise - strike_price_paise, 0)`.
- PE intrinsic per unit = `max(strike_price_paise - settlement_price_paise, 0)`.
- Gross payout = intrinsic per unit × settled quantity.
- Entry basis released = the complete fee-inclusive `cost_basis_paise` of the settled long position.
- Expiry charges = sum of separately calculated, date-effective, independently verified charge components.
- Net cash credit = gross payout − expiry charges.
- Net realized P&L = gross payout − entry basis released − expiry charges.

All values are integer paise; multiplication, addition, subtraction, and account totals must be checked against safe integer/database bounds before writes.

If the option expires OTM, gross payout is zero. The position is still closed after verified settlement, the complete entry basis is recognized as a realized loss, and no payout is credited. Expiry charges must follow the verified charge rules for the actual outcome; do not assume a zero charge or invent a charge.

**Charge schedule is a release blocker.** Before any posting implementation, independently verify the applicable statutory/exchange/brokerage charge components, taxable bases, rounding rules, effective dates, and whether each component applies to cash-settled expiry exercise. Store a versioned schedule identifier and component-level breakdown with the event. Do not copy the ordinary SELL-to-close fee function as a substitute for expiry exercise charges. If a charge component cannot be established, keep posting disabled.

The existing entry cost basis already contains BUY-side entry charges. Do not subtract those charges again. Do not add hypothetical exit brokerage unless an authoritative schedule says it applies.

## 6. Transaction boundary and lock order

One service-role-only database RPC should own the entire posting transaction. It must:

1. Validate authenticated backend identity and deterministic request fingerprint.
2. Lock `paper_accounts` row first, consistent with the current account-first serialization rule.
3. Lock the matching `paper_derivative_positions` row next.
4. Read/lock the instrument's outstanding LIMIT orders and verify all are terminal, reservations are zero, and no worker lease can still fill them.
5. Revalidate immutable contract, calendar, settlement evidence, and charge schedule inside the transaction.
6. Insert a unique immutable settlement event (unique account + instrument + expiry + settlement type/event key).
7. Credit account cash by net cash credit and add net realized P&L exactly once; increment account version.
8. Delete/close the long position and record the exact released basis and quantity in the settlement event.
9. Commit all changes atomically.

A retry with the same idempotency key and identical fingerprint returns the original event without a second cash credit. Reuse of the key with a different fingerprint is a hard conflict. A duplicate settlement event under another key must also be rejected. Concurrent close-fill versus settlement is serialized by the same account-first lock; only one operation may consume the position. No partial state is acceptable.

Do not update the account first and write the event later. Do not delete the position before all settlement evidence and charge calculations have passed.

## 7. Data model proposal (not migration-ready)

Introduce an immutable `paper_option_expiry_settlements` event table, separate from order/fill history. Candidate fields:

- Event identity: settlement_id, user_id, instrument_key, expiry, idempotency_key, request_fingerprint.
- Contract identity: exchange, segment, CE/PE, underlying identifier/type, strike, lot size, settlement type, contract-master version.
- Quantity and basis: settled_quantity, entry_cost_basis_paise, entry_average_price_paise.
- Price evidence: settlement_price_paise, source reference, payload object reference, payload SHA-256, source/publication/retrieval/verification timestamps, importer attestation/version, calendar version.
- Calculation: intrinsic_per_unit_paise, gross_payout_paise, charge_schedule_id, charge_breakdown JSON, total_expiry_charges_paise, net_cash_credit_paise, net_realized_pnl_paise.
- State/audit: simulation_only=true, posted_at, created_at, immutable evidence fingerprint.

Use database constraints for nonnegative quantities and charges, positive basis, safe monetary bounds, valid NSE index CE/PE identity, and `net_cash_credit = gross_payout - charges`, `net_realized = gross_payout - basis - charges`. Enforce unique event identity and idempotency identity.

Charge schedule definitions should be separately versioned and immutable with effective_from/effective_to, source evidence, calculation base, rate/flat amount, rounding method, and applicability conditions. Never edit a schedule version after an event references it.

Whether to add a generic account-ledger table is a separate schema decision: audit current account-ledger conventions first. If no immutable cash journal exists, the settlement event must itself be a complete immutable audit record and reconcile to the account version/cash delta. Do not invent a second competing ledger.

## 8. Required regression and reconciliation tests

All tests must run in disposable PostgreSQL transactions and roll back fixtures.

Eligibility and safety:
- Long index CE ITM, long index PE ITM, CE/PE OTM, exactly ATM.
- Reject stock option, physical settlement, unknown settlement type, short/zero position, invalid lot multiple, mismatched contract/underlying/expiry.
- Reject missing/unverified/stale/future settlement evidence, wrong date, wrong source field, tampered payload digest, conflicting official records, unsupported precision.
- Reject unverified or expired charge schedule and missing charge components.
- Reject settlement while a LIMIT order is pending/partially filled, reservation remains, or worker lease is active.

Accounting:
- ITM payout credits exactly intrinsic × quantity less verified charges.
- OTM payout is zero and releases full entry basis as realized loss.
- Entry BUY charges are included once through fee-inclusive basis, never double counted.
- Account cash, realized P&L, event amounts, position quantity, and released basis reconcile exactly.
- Multiple lots, paise rounding boundaries, maximum supported values, and zero payout.
- Same-key retry is a no-op; changed fingerprint conflicts; duplicate event under a new key conflicts.
- Concurrent duplicate expiry attempts post once.
- Concurrent settlement versus MARKET SELL/LIMIT fill/cancel cannot double-consume position or bypass reservations.
- Failure at every step rolls back event, cash, P&L, and position changes together.
- RLS prevents cross-user reads; only service_role can invoke posting RPC; event evidence is immutable to users.

## 9. Release gates before implementation

No settlement posting code or migration until all gates are signed off:

1. Exchange product/contract source confirms eligible NSE index contracts and cash settlement.
2. Trusted importer proves source authenticity and correct settlement field semantics.
3. Current statutory/exchange charge schedule and rounding rules are verified for expiry exercise, with effective dates.
4. The existing account journal/audit design is reviewed to avoid duplicate ledgers.
5. Disposable PostgreSQL tests cover all cases above, including concurrent races and rollback.
6. Staging parity and explicit user approval are obtained.

Until then, keep the current non-posting simulator unchanged: `settlementChargesPaise=null`, `netRealizedPnlPaise=null`, and `ledgerPostingAllowed=false`.


## 10. Regulatory charge-source audit (checked 2026-11-23)

This section records source findings, not an authorization to post charges.

### Verified statutory item

- **STT on exercise:** NSE's STT computation page, updated 2026-04-01, states that sale of an option where the option is exercised attracts **0.15%**, payable by the purchaser, calculated on intrinsic value. It also says STT is levied on the settlement price on the exercise day when the contract is ITM, and its exercise report contains taxable exercise value and STT at client/contract level.
- NSE Finance & Accounts Circular **NSE/FATAX/73524, dated 2026-03-31**, confirms Finance Act 2026 revised the exercised-option rate from 0.125% to 0.15%, effective **2026-04-01**.
- For this simulator's cash-settled index option, the charge candidate is therefore:
  `exercise_stt_paise = round_by_verified_exchange_rule(intrinsic_value_paise × 0.0015)`.
  The exact rounding/aggregation method must still be taken from authoritative exchange/clearing specifications or actual exercise reports; do not assume per-unit versus contract/client aggregation rounding.

Official sources:
- NSE STT computation: https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax
- NSE Circular NSE/FATAX/73524: https://nsearchives.nseindia.com/content/circulars/FATAX73524.pdf
- NSE SEBI turnover fees, STT and other levies: https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies
- Finance Act 2026 / Budget memorandum: https://www.indiabudget.gov.in/doc/memo.pdf

### Items not yet approved for the expiry charge schedule

- **Stamp duty:** NSE's general levy page lists equity options at 0.003% payable by the buyer, but the cited public page does not sufficiently establish the taxable base and whether an automatic cash-settled expiry exercise event is assessed on premium, intrinsic value, or attracts a separate amount. Do not apply 0.003% to intrinsic payout by assumption.
- **SEBI turnover fee:** NSE lists 0.0001% (₹10 per crore) for sale and purchase transactions in securities other than debt. The public summary does not settle the treatment/base/rounding for automatic expiry exercise specifically. Do not include it in expiry charges until exercise-specific applicability and taxable value are confirmed.
- **Exchange transaction/clearing charges:** No sufficiently authoritative exercise-specific schedule was established in this pass. Ordinary option trade transaction charges must not be copied onto expiry exercise without proof.
- **GST:** NSE's general page lists 18% GST on stock-broker services, payable by brokers and collected from clients. That does not establish GST on intrinsic settlement value. Only a verified taxable brokerage/service fee may carry GST; do not calculate GST on the cash settlement payout.
- **Brokerage and other broker fees:** These are broker-plan/service-specific and no universal expiry-exercise brokerage amount was verified. Keep absent unless a configured, evidenced broker schedule explicitly applies.

### Release decision

The **STT rate and base are confirmed**, but the complete charge schedule, exercise-specific rounding, and any other applicable component are not. Consequently the overall expiry charge schedule remains **unverified**, `settlementChargesPaise` and `netRealizedPnlPaise` must remain null, and `ledgerPostingAllowed` must remain false. Obtain NSE Clearing/clearing-member exercise reports or a current official exercise-specific charge specification before implementing charge posting.


## 11. Follow-up regulatory clarification (checked 2026-11-23)

### SEBI turnover fee — exercise turnover is in scope, but do not auto-debit the paper user

The **SEBI (Stock Brokers) Regulations, 2026**, notified in the Gazette of India on 2026-01-07, Regulation 41 and the Equity Derivatives fee table set the stock-broker fee at **0.00010% of turnover (₹10 per crore)**. The accompanying definition explicitly says derivatives turnover includes trades settled on expiry and, for options, premium turnover plus the notional value of option contracts exercised or assigned.

This confirms that option exercise contributes to the broker's SEBI regulatory turnover-fee base. It does **not**, by itself, establish that the fee is a separately chargeable client-level expiry debit in every broker's contract note or paper-trading fee model. Treat it as a broker regulatory cost until the chosen broker's current client charge schedule or exercise contract-note evidence proves the client allocation, taxable base, rounding and collection method. Do not automatically calculate it on intrinsic payout or debit it from the simulated user's cash.

Official source:
- Gazette of India, SEBI (Stock Brokers) Regulations, 2026, dated 2026-01-07, Regulation 41, Equity Derivatives row and options-exercise turnover explanation: https://egazette.gov.in/WriteReadData/2026/269177.pdf

### Exchange transaction charges — premium-traded basis only in located schedule

NSE Finance & Accounts Circular **NSE/FA/73061**, dated 2026-02-27 and effective 2026-03-01, states Equity Options transaction charges are calculated **on premium**. This schedule does not establish a separate transaction charge on intrinsic-value cash settlement at expiry. Do not apply the premium transaction charge a second time to expiry exercise; require a specific current clearing/exercise charge rule before adding one.

Official source:
- NSE Circular NSE/FA/73061: https://nsearchives.nseindia.com/content/circulars/FA73061.pdf

### Stamp duty — ordinary option rate is not enough to prove expiry-exercise debit

NSE's investor levy page lists **0.003% for Equity Options**, payable by buyer, and says clearing corporations collect stamp duty on securities transactions from 2020-07-01. However, that summary does not specify an independent stamp-duty base or a second stamp-duty event for automatic cash-settled index-option exercise. The general option rate must not be multiplied by intrinsic value or applied again at expiry without a rule/exercise statement establishing that exact event and base.

Official reference:
- NSE levies page: https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies
- Indian Stamp Act, 1899, section 9A: https://indiacode.ecourtsindia.com/stamp-act/section/9A/

### Updated release decision

Verified: exercise STT rate/base (0.15% of intrinsic value); exercise turnover inclusion for the broker's SEBI fee calculation; NSE's located Equity Options transaction-charge schedule is on premium turnover.

Not verified for a client-level paper-account expiry debit: exercise STT rounding/aggregation, client allocation of SEBI turnover fee, a separate expiry-exercise stamp-duty event/base, any separate exchange/clearing charge, and broker-specific brokerage/service charges. GST can only be assessed on a verified taxable service-fee base, not presumed on intrinsic settlement payout.

Therefore the complete **client-level expiry charge schedule remains unverified**. Keep `settlementChargesPaise=null`, `netRealizedPnlPaise=null`, and `ledgerPostingAllowed=false`. The next evidence required is a current NSE Clearing exercise/STT report plus a broker contract note/charge schedule for an ITM long index option expiry, with client-level component amounts and rounding. No posting implementation is authorized.


## 12. NSE Clearing exercise-report and UDiFF audit (checked 2026-11-23)

### Legacy F&O Exercise Report (F_EX01)

NSE Clearing publishes a formal F&O Exercise Report specification. Its filename pattern is `F_EX01_<Member code>_DDMMYYYY.CSV.gz`, delivered under the member's `/FAOFTP/F<MEMBER CODE>/REPORTS` directory. The documented fields include date, exercise number/date, clearing-member and member codes, account type, client account code, settlement type, instrument type, symbol, expiry, strike, option type, requested quantity, exercise type/style, final exercise type, exercise/do-not-exercise flag, acceptance flag, rejected quantity/reason, and valid exercise quantity.

This is useful evidence for contract/client-level exercise allocation and accepted quantity. **The published F_EX01 field list does not include the STT amount, taxable exercise value, settlement payout amount, or charge-rounding fields.** Therefore F_EX01 alone cannot settle the STT rounding or client charge-note questions. It should be joined only to authenticated official settlement/obligation and STT reports using stable member/client/contract/exercise identifiers, not used as a standalone cash-ledger instruction.

Official source:
- NSE Clearing, F&O Exercise Report specification: https://www.nseclearing.in/sites/default/files/2021-11/data_report_f_ex01.pdf

### NSE Clearing STT reports and client-level calculation evidence

NSE Clearing's current public STT computation page states that final exercise STT is levied on intrinsic value for an ITM option and that the member receives an end-of-day report containing total, trading-member-wise, client-wise STT liability and detailed client-wise computations. This confirms the existence of a more relevant STT evidence artifact than F_EX01. The public web page does not expose the report's detailed file schema, per-contract rounding sequence, or downloadable client report sample; member access appears necessary to inspect the actual computation rows.

Official source:
- NSE Clearing STT computation and member-report description: https://www.nseclearing.in/clearing-settlement/equity-derivatives/securities-transaction-tax

### UDiFF report standardization — relevant next artifact, not yet inspected at field level

NSE Clearing's UDiFF page states that Clearing Corporation reports have standardized formats for Trade, STT, CTT, StampDuty, Position, Obligation, Margin, Penalty, and Settlement Master reports, and publishes:
- Annexure B: report-format workbook.
- Annexure C: sample report ZIP.
- Circular references for UDiFF report standardization.

The page confirms these artifacts exist, but the linked XLSX/ZIP could not be parsed in this audit pass. No field names, rounding rule, or exercise charge base are inferred from the page title alone. The next research step is to inspect the current Annexure B STT/StampDuty/Obligation sheets and the corresponding F&O sample files, if publicly retrievable, and compare their field definitions with an actual member-side exercise/STT report.

Official source:
- NSE Clearing UDiFF formats and sample report links: https://www.nseclearing.in/udiff

### Accounting and implementation decision

The F_EX01 specification improves the evidence model for accepted exercise quantity and client/contract identity, but does not close the charge-calculation gap. UDiFF confirms dedicated STT and StampDuty report formats exist, but their schema and sample rows remain uninspected. No exercise posting, charge formula, or rounding method is authorized by this finding.

Keep `settlementChargesPaise=null`, `netRealizedPnlPaise=null`, and `ledgerPostingAllowed=false`. The required evidence remains: (1) actual current NSE Clearing STT report/UDiFF sample rows showing client-level taxable base, STT amount, and rounding; and (2) the selected broker's client contract note/charge schedule proving which exercise-related components are passed through to the client.


## 13. Official NSE STT report schema follow-up (checked 2026-11-23)

### Current NSE India F_STT01 exercise detail

The current NSE India Equity Derivatives STT page, updated 2026-04-01, publishes the F_STT01 trading-member report schema. Record Type 40 is explicitly the **client-contract-level exercise** record and contains:
- STT date, trading-member code, trading-client code.
- Instrument type, symbol, expiry date, strike, option type, CA level.
- Exercise quantity and exercise value.
- Taxable Exercise value, STT options, and Total STT.

The same page states that for an exercised option the taxable transaction value is intrinsic value, and the post-1-April-2026 rate is 0.15%, payable by purchaser. It also states member/client STT liabilities are aggregated from client liabilities.

This is stronger public evidence than the legacy F_STT02 PDF field list because the NSE India page currently exposes the F_STT01 Record Type 40 fields and the effective rate together. However, it still does **not** specify the rounding unit or sequence (per unit, contract, client, or aggregated record), nor does it expose actual member report rows with representative values. The existence of a Taxable Exercise value field and an STT options field does not, by itself, establish how the exchange rounds the calculation.

Official source:
- NSE India, Equity Derivatives STT computation and F_STT01 schema, updated 2026-04-01: https://www.nseindia.in/static/products-services/equity-derivatives-securities-transaction-tax

### UDiFF Annexure B/C retrieval status

The NSE Clearing UDiFF page (updated 2026-05-14) confirms Annexure B is the report-format workbook and Annexure C is the sample-report ZIP, covering STT, StampDuty, Position, Obligation and other report families. The direct links were identified:
- Annexure B: https://www.nseclearing.in/sites/default/files/2026-05/Annexure%20B_1.xlsx
- Annexure C: https://www.nseclearing.in/sites/default/files/2025-09/Annexure%20C%20-%20UdiFF%20Format%20Sample%20Reports.zip

The browser retrieval endpoint rejected both binary file types (XLSX and ZIP), and the execution environment could not fetch them directly. Therefore their workbook sheets, field definitions and sample rows were **not inspected** in this pass. Do not claim UDiFF field-level verification. NSE Clearing lists the member query contact as udiffstandardformats@nsccl.co.in.

Official source:
- NSE Clearing UDiFF page: https://www.nseclearing.in/udiff

### Revised finding and release status

Confirmed from the current public NSE schema: a client-contract exercise record includes exercise quantity, exercise value, taxable exercise value, STT options and total STT. This confirms the intended reconciliation keys/values for a member-side evidence adapter and identifies the exact report family to request.

Still not verified: rounding/aggregation semantics, actual client exercise STT report rows, current UDiFF STT/StampDuty schemas and samples, and which components a selected broker passes through to its client.

For a future evidence adapter, retain the complete original record (not only the total) and reconcile at least client + instrument + expiry + strike + option type + CA level + exercise quantity/value + taxable exercise value + STT amount. Do not infer a rounding rule from the rate or reverse-engineer one from a single aggregate.

No posting implementation is authorized. Keep settlementChargesPaise=null, netRealizedPnlPaise=null, and ledgerPostingAllowed=false.