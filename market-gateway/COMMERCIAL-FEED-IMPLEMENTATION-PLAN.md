# S-TRADE Commercial Market-Data Feed Onboarding Plan

**Created:** 2026-11-28  
**Status:** Engineering preparation only — NOT approved for live feed activation, public redistribution, or production deployment.  
**Base:** Provider-contract work from PR #284, commit `243cabb5686106f14c34a15736c2072bfaa67c46`.

## 1. Objective

Evaluate and prepare a provider-neutral, centrally ingested market-data path for ZENURA IGNITE S-TRADE. The proposed model is one licensed upstream vendor feed consumed by a server-side ingestion service and distributed to authenticated app users through the S-TRADE gateway.

This is a proposed architecture, not evidence that TrueData, Global Datafeeds (GFDL), NSE, or BSE has granted the required rights.

## 2. Current verified baseline

- The gateway already has provider-neutral contracts, routing, provider health handling, rate-limit controls, timestamp/freshness validation, instrument identity checks, and Upstox / Angel One adapter foundations.
- The current stream path is based on authenticated per-user Upstox authorization and per-user stream reservations/leases; it is not yet a centrally shared vendor-feed architecture.
- The market-data rights gate requires BOTH:
  - `MARKET_DATA_RIGHTS_APPROVED=true` with a real `MARKET_DATA_RIGHTS_REFERENCE`; and
  - `MARKET_DATA_REGULATORY_APPROVED=true` with a real `MARKET_DATA_REGULATORY_REFERENCE`.
- The existing compliance evidence register records provider, exchange, and product-level permissions as MISSING/BLOCKED. No vendor or exchange redistribution approval is established by this plan.
- The current PWA artifact build deliberately includes only synthetic demo fixtures; it does not deploy a live gateway.

## 3. Target architecture — conditional on written rights

```text
Licensed Vendor WebSocket / REST
              |
              v
Server-side Vendor Ingestion Worker
  - authenticated vendor session
  - reconnect / heartbeat / health
  - source sequence + exchange timestamps
  - instrument mapping and validation
              |
              v
Normalized Market Event Contract
              |
              v
Redis (only if agreement permits cache/storage)
  - latest quote / bid / ask / volume / OI
  - Pub/Sub or Streams for fan-out
  - bounded TTL and retention policy
              |
              v
Authenticated S-TRADE WebSocket / SSE Gateway
  - user authentication
  - instrument-level subscription authorization
  - per-user / per-tenant quotas
  - entitlement and audit checks
              |
              v
Stocks UI / Charts / Option Chain / Paper Simulation
```

The central feed must not be built by forwarding a user's personal broker OAuth token to other users. Vendor credentials remain server-side and separate from broker-execution credentials. The market-data path must remain separate from broker order placement; S-TRADE paper orders remain virtual.

## 4. Vendor evaluation: TrueData and Global Datafeeds

Do not choose a vendor from API convenience or a sales brochure alone. Obtain a written, product-specific proposal and verify:

- Vendor's authority and upstream NSE/BSE data-owner licensing chain, including sublicensing rights.
- Explicit permission for a public or private multi-user paper-trading / simulation application.
- Whether one central feed may serve multiple downstream users and devices.
- NSE/BSE segments and exact instruments: cash, indices, futures, options and option-chain fields.
- Exact feed classes: real-time tick, bid/ask, market depth, snapshots, delayed data, EOD and historical candles.
- Explicit rights for charts, indicators, derived values, IV/Greeks, virtual fills, P&L, alerts, exports and notifications.
- Redis/in-memory caching, Pub/Sub, transient buffering, persistence, backups, historical retention and deletion terms.
- User, device, concurrent connection, throughput, symbol-subscription and API-rate limits.
- Attribution, display rules, reporting, audit rights, fees, term, renewal, suspension and termination.
- Separate REST historical-data entitlement and rate limits.

No vendor pricing, entitlement, or feature coverage is assumed in this document. Compare the signed offer and agreement side-by-side before selection.

## 5. Compliance release gates — fail closed

Before any live vendor connection or user-facing real-time distribution:

1. Receive and independently verify the executed vendor agreement and its upstream exchange/data-owner rights.
2. Obtain written provider/exchange permission expressly covering S-TRADE's paper-trading use, multi-user distribution, channels, data classes, cache, derived data and user limits.
3. Obtain a written opinion from qualified Indian securities counsel on the actual public simulator and its features, including SEBI PR No. 37/2024 and the applicable price-data sharing / educational-use framework.
4. Determine whether any SEBI, exchange, intermediary, or other approval/registration is required.
5. Record real evidence references in the restricted release environment. Never use placeholder references or set approval flags merely to make a test pass.
6. Keep both runtime approval flags unset/false until the two independent approvals are actually received.

The 30-day educational-data framework and NISM simulation-lab exception must not be assumed to cover S-TRADE. A delayed label, disclaimer, vendor subscription, or API key alone is not approval.

## 6. Engineering implementation sequence after approval

### Phase A — provider adapter (no public feed)
- Add a dedicated adapter only for the selected, approved vendor.
- Inject the vendor client; keep credentials in server-side secret storage.
- Normalize prices to integer paise and retain provider ID, instrument ID, exchange, source sequence, exchange timestamp, receive timestamp, entitlement reference and attribution.
- Reject unknown instruments, provider/instrument mismatch, duplicate/out-of-order events, stale/future timestamps, malformed depth and invalid OHLCV.
- Add deterministic fixtures and contract tests; never use captured restricted live ticks as test fixtures unless the agreement expressly permits it.

### Phase B — ingestion and fan-out (after cache and redistribution rights)
- Run one independently supervised ingestion worker with bounded reconnects, heartbeats, health state and back-pressure.
- Use Redis only within the agreement's permitted cache and retention scope. Apply TTLs and explicit deletion on entitlement revocation.
- Fan out only authorized symbols to authenticated WebSocket/SSE clients. Enforce tenant/user quotas, subscription limits and audit records.
- Prevent cross-user leakage and ensure a stale or disconnected feed is shown as stale/unavailable, never as live.

### Phase C — consumers
- Historical candle API: use the separately licensed historical endpoint and enforce allowed intervals/range.
- Option Chain: expose only licensed fields; compute IV/Greeks only when source rights and calculation assumptions are documented.
- Paper execution: feed the existing virtual execution engine with validated bid/ask/market events. Model partial fills, price-time ordering, slippage, cancellation races and idempotency. Do not equate LTP touch with a guaranteed fill.
- Keep Delivery LIMIT / scheduled workers disabled until their separate reviewed activation gate is satisfied.

### Phase D — verification
- Unit and contract tests for every adapter and data shape.
- Multi-user integration tests for isolation, quotas, subscriptions, revocation and reconnect races.
- Load tests for target concurrent users, symbols and tick rates based on the actual vendor contract.
- Browser tests for stale-data states, chart gaps, option-chain freshness and reconnect behavior.
- Security review for secret handling, auth, rate limits, denial-of-service controls and logs.
- Exact-head CI and independent review before any merge; separate staging and production approval.

## 7. Explicit non-goals and safety

- No live feed is enabled by this document.
- No vendor credentials, OAuth secrets, or confidential contracts are committed.
- No hosted Supabase writes or migrations.
- No production deployment, PR merge, or public data redistribution.
- No real broker orders.
- Do not enable the scheduled LIMIT worker.
- Do not modify Crypto folders or Crypto data paths.
- Preserve existing Demo fixtures, paper wallet, order/ledger accounting, Supabase RLS, UI modules and PWA behavior.

## 8. Decisions still required from documentary evidence

- Selected vendor and exact legal entity.
- Signed commercial redistribution / simulator-use scope.
- Upstream exchange rights and segment coverage.
- Written Indian securities-law clearance for the product.
- Permitted cache, retention, historical-data and derived-data behavior.
- Contracted concurrent users, symbols, tick throughput and commercial limits.

**Current decision: PREPARE THE ISOLATED ENGINEERING PATH; KEEP LIVE DISTRIBUTION BLOCKED.**
