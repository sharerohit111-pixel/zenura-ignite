# S-TRADE Indian Market Data Legal Evidence Register

**Review date:** 2026-11-26  
**Related change:** PR #250 — Indian market-data rights compliance gate  
**Disposition:** BLOCKED. No provider, exchange feed, or public paper-trading use is legally cleared by this register.

> This is an evidence-tracking control, not legal advice, a licence, provider approval, or regulator/exchange clearance. Blank fields mean evidence has not been established. Do not change runtime approval flags based on this register.

## 1. Evidence status vocabulary

- **MISSING** — no signed/retrievable documentary evidence established in the repository audit.
- **RECEIVED — UNVERIFIED** — supplied but authenticity, signatory authority, current validity, upstream rights and scope have not been independently checked.
- **VERIFIED — SCOPE LIMITED** — independently checked and covers only the exact product, data class, channel, users, geography and term recorded.
- **EXPIRED / REVOKED** — disable the affected entitlement.
- **NOT APPLICABLE — COUNSEL CONFIRMED** — only with a reasoned written determination from qualified Indian securities counsel.

An API working, subscription, successful OAuth, test pass, sales email or self-attestation is not legal approval.

## 2. Provider and exchange evidence matrix

No signed provider/exchange agreement was established in the PR #250 repository inspection. All permissions below remain **MISSING**.

| Party / source | Existing engineering policy | Required documentary evidence | Status |
|---|---|---|---|
| Upstox | Approval required; not authorized for public simulator distribution | Signed Upstox legal/compliance permission naming ZENURA IGNITE S-TRADE and expressly covering paper-trading simulation, feed classes, app display, downstream users, redistribution, derived outputs, storage/cache, attribution, limits, fees, term, termination and upstream exchange rights | MISSING |
| Angel One SmartAPI | Approval required; not authorized | Equivalent signed product-specific permission and upstream exchange/data-owner rights | MISSING |
| Zerodha Kite Connect | Hard-denied by current policy | Do not use unless an express signed agreement overrides the applicable virtual/mock-trading restriction for this exact product and use | MISSING — KEEP DENIED |
| DhanHQ | Hard-denied by current policy | Do not use unless express signed permission changes its stated restriction for this exact product and use | MISSING — KEEP DENIED |
| FYERS | Hard-denied by current policy | Do not use unless express signed permission overrides its paper/virtual trading restriction for this exact product and use | MISSING — KEEP DENIED |
| NSE / NSE Data & Analytics | No distribution rights established | Executed licence for exact segments, products, feed classes, public app/mobile display, simulator purpose, user/device scope, redistribution, derived data, retention, attribution, audit and fees | MISSING |
| BSE / appointed licensor | No distribution rights established | Executed BSE or appointed-licensor agreement; confirm territory/product applicability and downstream app display/simulator permissions | MISSING |
| Intermediary data vendor | Approval required | Vendor authorization chain from each upstream exchange/data owner and executed sublicensing/downstream distribution rights covering S-TRADE and each data category | MISSING |
| Independent synthetic data | Development/demo only, subject to product legal review | Provenance and generation method proving no restricted feed was copied, transformed, sampled, delayed, reverse-engineered or calibrated | NO MARKET-DATA LICENCE |

## 3. Data-category entitlement matrix

Record a separate verified scope for every provider × exchange × segment × data class × channel × user group combination.

| Data category | Required scope | Current decision |
|---|---|---|
| Real-time quotes / LTP / streaming | Source, exchange, segment, fields, app display, simulator use, redistribution, user entitlements and SEBI restrictions | BLOCKED |
| Tick-by-tick / trades | Above plus event storage, replay and derived calculations | BLOCKED |
| Market depth / order book | Depth level, segment, display, redistribution, retention and derived display | BLOCKED |
| Snapshot feeds | Snapshot frequency, audience, display medium and downstream distribution | BLOCKED |
| Delayed feeds (including 15-minute) | Exact delay, licence product, downstream feed consent, app/mobile display and simulator permission | BLOCKED |
| 30-day delayed educational data | Counsel confirmation of qualifying education/awareness activity, no monetary incentives, source permission, legal agreement, safeguards and audit trail | CONDITIONAL REVIEW ONLY — NOT APPROVED |
| NISM one-day simulation-lab data | NISM-specific eligibility and written authorization; no assumption that the exception extends to S-TRADE | NOT AVAILABLE ON PRESENT EVIDENCE |
| EOD / historical candles | Product, date range, replay, storage, display, redistribution and derived outputs | BLOCKED |
| Instrument master / identifiers / reference data | Source, fields, download, retention, cache, display and redistribution | BLOCKED |
| Corporate actions / reference datasets | Exact product, fields, updates, storage, redistribution and downstream use | BLOCKED |
| Derived values (charts, indicators, P&L, alerts, exports) | Contract treatment of derived data, display, persistence, export and user access | BLOCKED |

## 4. Product-level Indian legal clearance

**Status: MISSING.** Obtain a signed opinion from qualified Indian securities counsel addressing the actual S-TRADE product, not merely its API.

The opinion must examine:

1. SEBI's 4 November 2024 advisory on unauthorized virtual-trading / gaming platforms (PR No. 37/2024).
2. SEBI's 24 May 2024 real-time price-data sharing circular and subsequent amendments.
3. SEBI's 29 January 2025 association-related circular and relevant FAQ as amended.
4. SEBI's 8 May 2026 educational price-data circular, its 1 July 2026 effective date, 30-day lag, legal agreement and audit/safeguard requirements, and NISM-specific one-day exception.
5. Whether S-TRADE's public simulator, virtual fills, price-driven portfolio/P&L, ranking, alerts, signals, recommendations, marketing, monetization and user acquisition are permissible and under what conditions.
6. Whether registration, association, exchange permission, intermediary involvement, other approvals, restrictions or product changes are required.
7. Whether the education/awareness route applies to this product and each proposed data category.

A disclaimer, no-cash virtual balance, per-user broker OAuth, delayed label or provider API subscription is not a substitute for this opinion.

## 5. Contract scope checklist

For each agreement, verify explicit answers; do not infer permission from silence.

- [ ] Named legal operator and product: ZENURA IGNITE S-TRADE.
- [ ] Paper-trading / simulation use expressly permitted.
- [ ] Exchange, segment, instruments and data fields listed.
- [ ] Each feed class and exact delay listed.
- [ ] Website, Android/PWA/mobile and other display channels listed.
- [ ] Public/private audience, geography, user/device/concurrent-session limits listed.
- [ ] Redistribution, downstream access and end-user entitlement model stated.
- [ ] Storage, cache, backups, historical retention, derived data and deletion rights stated.
- [ ] Charts, indicators, virtual fills, P&L, alerts, exports and notifications addressed.
- [ ] Attribution wording, logo use and placement specified.
- [ ] Fees, reporting, audits, inspections and records specified.
- [ ] Security, subcontractors, data location and incident notification specified.
- [ ] Effective date, expiry, renewal, termination and revocation process specified.
- [ ] Upstream exchange/data-owner authorization and sublicensing chain verified.
- [ ] Signatory identity and authority independently verified.
- [ ] Counsel confirms agreement is consistent with the product-level legal opinion.

## 6. Approval evidence record

Complete one record per provider and distinct permission scope. Keep signed contracts in an access-controlled legal/compliance repository; do not commit confidential contracts, personal data, credentials or commercially sensitive schedules to this public GitHub repository.

| Field | Required value |
|---|---|
| Provider / exchange / vendor | Exact legal entity |
| Product and operator | Exact legal names |
| Exchange / segment | NSE/BSE and segment |
| Data class / fields | Exact categories and fields |
| Use and channels | Simulator, display, derived data, export, etc. |
| User / geography scope | Contractual limits |
| Agreement identifier | Real document reference, not placeholder |
| Signed / effective dates | Dates in executed document |
| Expiry / renewal | Date and conditions |
| Upstream rights evidence | Document reference and scope |
| Attribution requirements | Exact contractual wording |
| Retention / deletion | Permitted duration and process |
| Revocation process | Verified operational path |
| Reviewer / review date | Authorized reviewer |
| Counsel opinion reference | Separate legal opinion reference |
| Evidence location | Restricted document-store reference |
| Verification status | Vocabulary from section 1 |

## 7. Runtime gate mapping

The following remain **unapproved** until independent documentary review is complete:

- `MARKET_DATA_RIGHTS_APPROVED`
- `MARKET_DATA_RIGHTS_REFERENCE`
- `MARKET_DATA_REGULATORY_APPROVED`
- `MARKET_DATA_REGULATORY_REFERENCE`

Rules:

1. Provider/exchange rights and product-level legal/regulatory clearance are separate approvals.
2. Each reference must resolve to a signed, retrievable document and recorded scope.
3. Approval for one provider, exchange, segment or data class does not authorize another.
4. Expiry, termination, scope change or revocation disables the affected feed.
5. A placeholder, ticket number, API key, self-attestation, CI result or this register is not approval evidence.
6. Keep all unapproved and unreviewed feeds fail-closed.
7. Test every production route, warm cache, worker, instrument-master refresh and generic provider router.
8. No deployment or feed activation is part of evidence collection.

## 8. Immediate actions

| Action | Responsible party | Completion evidence |
|---|---|---|
| Obtain S-TRADE product-specific legal opinion | Product owner + qualified Indian securities counsel | Signed opinion addressing section 4 |
| Request Upstox and Angel One simulator-use permissions | Product owner | Executed provider letters/agreements |
| Obtain NSE/BSE or authorized vendor licence route | Product owner + exchange/vendor | Executed licence and upstream chain |
| Confirm feed-class scope and attribution | Provider/exchange + counsel | Signed schedule / written confirmation |
| Review retention, deletion and revocation controls | Engineering + compliance reviewer | Control mapping and test evidence |
| Verify each document and populate evidence records | Independent authorized reviewer | Dated review and document references |
| Re-run technical gates after code changes | Engineering | Exact-head CI evidence |
| Consider release approval separately | Authorized legal/compliance owners | Explicit signed release decision |

**Final disposition: BLOCKED.** This register records outstanding evidence only. It does not grant, imply or create legal permission. No merge, deployment, feed activation or approval-variable change is authorized by this file.


## 9. Explicit NSE Clause 7.4 blocker — reviewed 2026-11-27

**Primary-source finding:** The consolidated NSE / NSE Data Sharing & Usage Policy, Clause 7.4, states that Market Data shall not be provided to individuals/entities/platforms/apps/websites engaging in online gaming, virtual trading or simulation, fantasy games, similar activities, or activities prohibited by applicable laws/regulators/authorities. Clause 7.3 separately limits redistribution to what is agreed in the Relevant Agreement. The policy definition of Market Data includes real-time, snapshot, delayed, EOD, historical and corporate data and securities/derivatives identifiers, prices, volumes and trade-related data.

- Official consolidated policy PDF: https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_Data_Sharing%26Usage_Policy.pdf
- Official NSE policy page: https://www.nseindia.in/static/market-data/nse-data-policy
- Separate NSE circular NSE/COMP/56426 (20 April 2023): https://nsearchives.nseindia.com/content/circulars/COMP56426.pdf

**Decision for S-TRADE:** Because the product is a paper/virtual trading simulator, NSE-sourced Market Data is **BLOCKED** on the present evidence. Do not treat a routine data subscription, broker API/OAuth, vendor relationship, delayed/EOD/historical label, or educational/NISM label as an override. No exception or waiver has been established. This is an engineering/compliance hold, not a legal opinion on whether NSE could grant any specific permission.

**Evidence required to reconsider:**
- [ ] Written NSE/NSE Data legal/compliance response naming ZENURA IGNITE S-TRADE and expressly addressing Clause 7.4.
- [ ] Written confirmation of whether the exact simulation use and each requested data class/channel/end-user model is permitted under current policy and SEBI directions; if not permitted, record the rejection and keep NSE source disabled.
- [ ] Qualified Indian securities counsel's signed opinion on the proposed route and any conditions.
- [ ] If permitted, executed licence schedule covering the precise source, segments, fields, data classes, display, users, redistribution, derived data, storage, attribution, audit and revocation.
- [ ] Independent reviewer verifies authenticity, authority, validity and scope before either runtime approval gate can be considered.

**Fail-closed rule:** Until every applicable item is verified, MARKET_DATA_RIGHTS_APPROVED and MARKET_DATA_REGULATORY_APPROVED remain unapproved; NSE provider routes and all NSE data classes remain disabled. Synthetic fixtures must be independently generated and must not be copied, sampled, transformed, delayed or calibrated from restricted NSE/vendor feeds. Product-level legal review remains necessary even for synthetic-data public simulator launch.
