# S-TRADE Futures & Options Demo UI Integration Audit

Date: 2026-11-24
Repository: sharerohit111-pixel/zenura-ignite
Integration base: PR #150 (canonical Round 2 Demo screens), stacked on PR #145 and PR #137

## Existing production F&O modules audited

### Futures
- PRs #87–#89 own the atomic LIMIT submit, opening-margin / close-quantity reservations, fill settlement, cancellation, expiry and bounded worker lifecycle.
- PR #93 owns worker lease heartbeat, lease-loss fencing and session-aware cursor safety.
- PRs #96 and #114 own Futures MARKET order boundaries, verified NSE session/tick checks and executable best-bid/best-ask policy.
- PRs #107/#109 cover the multi-level MARKET depth-sweep design/helper.
- PR #135 is the current separate Futures risk-ledger candidate; it is not a source of Demo accounting.

### Options
- PR #90 is the long-only CE/PE LIMIT design; PR #91 owns the LIMIT lifecycle tables, reservations, partial fills, cancellation, expiry and worker.
- PRs #97/#98/#113/#117/#118 cover worker, quote-side, reservation and authenticated test hardening.
- PR #128 owns the current Options LIMIT worker heartbeat; PR #119 is superseded and must not be duplicated.
- PRs #122/#129 cover the Options accounting/read-model and invariant work.

These backend PRs remain separate Draft/stacked work. Their production RPCs, ledgers, reservations, charges, margin, RLS, authentication and workers are not copied into the browser Demo.

## Integration decisions

- PR #149 supplied the deterministic browser-memory simulator, the shared derivative position transition helper, synthetic contracts/quotes, schema definitions and regression tests.
- Its standalone markets/stocks/derivative-mock-workspace.* panel was not copied into the authenticated markets/stocks/index.html terminal. The simulator is instead mounted from the canonical markets/stocks/demo.html route through demo-derivative-panel.mjs.
- The canonical shared derivatives.json fixture and domain schema are extended in place; there is no second fixture loader, adapter, instrument master or position arithmetic helper.
- The simulator reuses applyDerivativeFill for average-price and realized position transitions. Futures support Intraday/Delivery and signed long/short positions. Options CE/PE BUY opens/adds; SELL is restricted to closing unreserved long quantity.
- MARKET BUY uses deterministic ask and SELL uses deterministic bid, rejecting insufficient top-of-book depth in full. LIMIT orders use side-correct executable quotes and explicit manual matching, allow whole-lot partial fills, and support cancel of the unfilled remainder.
- Expiry and strike selection are available from the synthetic Options contracts. All order receipts, positions and fills are in browser memory only.

## Isolation and release boundary

- Demo UI loads only MOCK-prefixed contracts and MOCK-labelled fixture quotes. It has no live-data fallback.
- The shared Demo adapter remains the single canonical read-only view-model adapter for the dashboard fixture set; the F&O simulator is a separately mounted local execution capability, not a replacement adapter.
- Production Futures/Options RPCs, account reservations, cash/ledger posting, fees, margin, RLS, auth and workers remain unchanged and are never imported/called by this Demo panel.
- No migrations, provider credentials, broker orders, database writes, worker activation, feature-flag changes, deployment or merge are included.
- The PWA shell caches the Demo panel, simulator helper and shared synthetic derivatives fixture.

## Verification

- Full market-gateway Node regression suite and package syntax checks are run by the dedicated integration workflow.
- Dedicated integration tests assert F&O Demo wiring, expiry/strike/product controls, manual matching, cancellation, fixture identity and production gateway isolation.
- Browser/mobile visual QA remains a separate release gate; CI success does not claim real exchange data or production trading readiness.
