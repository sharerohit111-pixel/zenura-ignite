# S-TRADE Round 1 — Integration Audit & Round 2 Plan

Date: 2026-11-24
Repository: sharerohit111-pixel/zenura-ignite
Audit baseline: PR #137 head `1dfa19e1b7d30c494c7edff8c3ca77acecc48acc`
Scope: Indian Market Paper Trading only (NSE/BSE). Crypto is excluded.

## Executive result

Round 1 is **not integration-complete**. PR #137 supplies a sound first shared Dummy JSON contract/fixture foundation, but it is deliberately test-only and is not consumed by the existing browser workspaces or authenticated gateway. The currently visible branch contains five fixture payloads (market, account, equity, derivatives, error), two JSON schemas, a fixture loader and one focused Node test file. The focused tests cover envelope metadata, ₹10,00,000 starting capital (100,000,000 paise), unknown fixture rejection, production guard and detached copies.

This is not evidence that all screens are running on one Dummy JSON source. No screen-level adapter or browser/mobile harness is present in the PR #137 changed scope. Do not describe the screens as integrated until Round 2 completes those consumer tests.

## PR / branch integration findings

- PR #137 is Draft and targets `feature/s-trade-mock-contract-architecture-2026-11-24`. It adds architecture and fixtures, not runtime screen integration.
- PR #137's exact head `c2c337383ba9475858c9e69a8cf651c6b673cb9e` subsequently passed the dedicated Mock Contract Tests and the full Paper Trading Supabase SQL smoke workflow (71/71 steps successful, including migration/RLS, tenant isolation and protective-order concurrency checks). This validates that PR #137's base branch checks passed; it does not validate independent PR heads or browser/mobile screen integration.
- The dedicated `s-trade-mock-contracts.yml` workflow runs JSON parsing, the focused fixture test and a grep guard against importing the fixture loader into production gateway entrypoints. It does not run the full `npm test`, `npm run check`, browser E2E, mobile viewport/device tests or the full security/RLS suite.
- `market-gateway/package.json` defines `npm test` as all Node tests and `npm run check` as a selected syntax-check list. Those commands were not executed by this remote audit.
- PRs #92, #94, #100, #102, #111, #121, #124, #126, #131, #134, #135, #136 and #137 are open Draft PRs in the inspected inventory. PR #123 is closed/unmerged and superseded by refreshed PR #126. These are separate heads/bases, not one tested integrated branch. Their code must not be presumed present together.
- PR #131 explicitly marks the wallet snapshot `ledgerReconciled=false`; a unified Equity/Futures/Options balance and P&L must remain visibly unreconciled until a canonical cross-asset ledger/read model is verified.
- PR #136's price-alert worker is provider-backed and separate from deterministic fixture playback. It must not be silently activated or used as a source for MOCK screens.
- PR #135 is a Futures risk/MTM/settlement workstream; its margin and settlement logic must remain the authoritative owner rather than being copied into a mock layer.
- Crypto PRs/paths remain excluded. No Crypto code, schema, fixtures or workflow should be included in this integration chain.

## Required Round 1 status by area

| Area | Audit status | Evidence / blocker |
|---|---|---|
| Shared JSON envelope | Foundation exists | v1.0.0 envelope and domain schema in PR #137 |
| Deterministic fixtures | Partial foundation | Five fixtures; test-only loader |
| Equity / Futures / Options screens | Not verified integrated | No screen consumer adapter in PR #137 |
| Market / Watchlist / Charts | Not verified integrated | Fixture exists, but no verified shared screen binding |
| Login / Account / Wallet | Not reconciled | Auth PR #131 is Draft; wallet explicitly unreconciled |
| Orders / Trades / Positions / Holdings | Not reconciled end-to-end | Existing domain engines/read models span separate Draft PR heads |
| Charges / Realized / Unrealized P&L | Not reconciled end-to-end | Requires canonical ledger/read-model parity across assets |
| Unit tests | Partial | Focused fixture tests exist; full suite not run here |
| Integration tests | Not verified | No single combined stack result |
| Browser tests | Gap | No verified browser E2E result for all screens |
| Security / tenant isolation | Partial / unverified as combined stack | Existing PR tests are separate; exact integrated branch not green |
| Mobile responsive tests | Gap | Static/UI code exists; no real-device or automated viewport matrix result |
| PostgreSQL migration/RLS | In progress, not passed | Run #1537 was still running; pending steps at audit time |

## Integration rules to preserve

1. Keep one versioned envelope: `schemaVersion`, `mode`, `simulated`, `requestId`, `asOf`, `meta.source`, `data`.
2. Synthetic fixtures must use `mode=MOCK`, `simulated=true`, synthetic non-tradable symbols and explicit DEMO DATA labeling.
3. All money is integer paise; quantities/lots are integers; timestamps carry an explicit timezone.
4. A single fixture/adapter layer may supply screen test data, but must never be imported into production gateway routes or become a fallback for authenticated APIs.
5. Reuse existing Equity/Futures/Options order engines, workers, reservation rules, fees, margin and ledger RPCs. Do not add a second fill engine, account, instrument master, worker or ledger.
6. Never merge stacked PRs merely by number. First establish a dependency graph, one canonical migration chain, exact commit ancestry and a clean integration branch.
7. Keep Crypto in its separate project boundary.

## Round 2 implementation plan

### R2.1 — Build a clean integration branch
- Select a single reviewed base and record the exact head SHA of every candidate PR.
- Resolve dependencies for PR #92/#94/#100/#102/#111 (Equity), #121/#124/#126/#134 (market/instruments), #122/#129/#135 (Options/Futures accounting/risk), #131 (accounts), #130 (frontend UX), #136 (notifications/security), and #137 (fixtures).
- Explicitly exclude superseded #123 and retain Crypto PRs outside the branch.
- Detect duplicate migration timestamps, helper functions, route mounts, browser script imports and overlapping ownership before any consolidation.

### R2.2 — Screen consumer adapters (fixture-only)
- Add one browser-safe adapter that validates the shared envelope and returns detached fixture data only when an explicit non-production test/demo harness is selected.
- Map Home/Market/Index, Watchlists, Equity, Futures, Options, Charts/Depth, Orders, Portfolio/Positions/Holdings, Account/Wallet, Trade History and Settings to the existing UI components.
- Show a persistent DEMO DATA label; never imply live exchange prices or real broker execution.
- Keep the signed-in production path on the authenticated backend. No runtime silent fallback.

### R2.3 — Accounting contract parity
- Add golden-vector tests for ₹10 lakh initial capital, available/blocked cash, equity delivery/intraday, FUT margin/MTM, CE/PE premium, fees/charges, partial fills, cancel/expiry, realized/unrealized P&L and replay/idempotency.
- Assert the same order/fill/position/ledger identifiers across UI read models and backend records.
- Keep wallet reconciliation visibly false until one canonical snapshot is proven transactionally consistent.

### R2.4 — Test gates
- Unit: all gateway Node tests, schema validation, fixture immutability and adapter mapping.
- Integration: auth/RLS tenant isolation, order lifecycle, worker lease, partial fill/cancel races, ledger reconciliation and pagination.
- Browser: all screens render fixture and empty/loading/error states; no console errors; navigation and actions are wired.
- Security: production fixture import guard, auth required, verified user identity, cross-user isolation, no client-trusted roles, no secrets in browser, no live provider/order side effects in MOCK mode.
- Mobile: 320/360/390/412 px widths, portrait/landscape, safe areas, no horizontal overflow, touch targets, drawer/scroll and chart/order-ticket usability.
- PostgreSQL: disposable database only; ordered migration chain and privilege/RLS tests.
- Publish exact commit SHA, workflow URL, test counts and failures. Never mark unrun tests as passed.

## Out of scope / prohibited

No live API purchase or integration, broker credentials, real orders, production/staging migration, PR merge, feature activation, deployment, or Crypto work. Any later release action requires separate explicit approval.


## Round 2 follow-up — 2026-11-24

### New adapter PR
- PR #145 adds a browser-safe, pure consumer adapter over PR #137's canonical market/account/equity/derivatives fixtures.
- Adapter requires explicit `{ enabled: true }`, rejects production mode, accepts only `MOCK|` instrument keys and `MOCK` provider quotes, preserves integer paise, and carries `ledgerReconciled=false` without upgrading it.
- It does not fetch, authenticate, persist, submit orders, import a provider, or touch the ledger. It is not yet wired into dashboard or chart screens.
- Exact-head PR #145 dedicated contract/adapter workflow passed at commit `583a86b3ff0eaac4cd5ea42e620cb710680594fb`: JSON parsing, fixture regression tests, adapter tests and production gateway import guard all succeeded.
- PR #145's full PostgreSQL smoke workflow is not yet complete; the latest observed run was still in progress. Do not claim a full-stack/database pass for PR #145 until that exact head finishes.

### Newly confirmed consumer mismatches
- PR #138's dashboard fixture uses real-looking NSE symbols (e.g. RELIANCE/HDFCBANK) with illustrative price values. Although the fixture labels itself DEMO/DUMMY_JSON, it does not meet the canonical non-tradable MOCK-symbol rule. Do not connect these prices to live quote, valuation, order execution or the canonical adapter. Before integration, replace them with synthetic MOCK instrument identities and revalidate the dashboard calculations.
- PR #139's chart demo uses a separate DEMO-prefixed instrument namespace and its own fixture contract. It is correctly labelled synthetic and read-only, but it is not yet the PR #137 canonical envelope. Add an explicit, tested mapping to the shared v1 envelope or update the chart consumer to the shared view model; do not allow DEMO and MOCK namespaces to drift.
- The current adapter returns a shared read-only model but does not yet wire the nine dashboard screens or chart workspace. Browser/mobile E2E remains a release gate.

### Revised Round 2 status
| Work item | Status |
|---|---|
| Canonical shared fixture foundation (PR #137) | Dedicated CI passed on its latest observed exact head; full DB gate remains separate |
| Shared browser-safe consumer adapter (PR #145) | Implemented; exact-head dedicated CI passed |
| Dashboard fixture normalization (PR #138) | Blocked pending replacement of real-looking symbols/illustrative quotes |
| Chart demo contract alignment (PR #139) | Pending canonical MOCK envelope adapter |
| Screen-by-screen consumer wiring | Not yet done |
| Cross-asset ledger/account reconciliation | Not yet done; PR #131 wallet remains unreconciled |
| Browser/mobile/security full integration | Not yet verified |
| Full PostgreSQL migration/RLS smoke on PR #145 head | In progress at this update |

No PR was merged, no production or staging migration was applied, and no live API or Crypto code was added.
