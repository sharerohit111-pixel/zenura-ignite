# Indian Stock Market first — S-TRADE execution plan

**Decision:** Complete and validate the Indian Stock Market experience before resuming the separate Crypto backend work. This is a sequencing decision, not a deletion or merge decision.

## Repository baseline inspected

- Active integration candidate: `integration/supabase-native-auth-professional-launch-2026-11-22`.
- Indian Stock Market UI is isolated under `markets/stocks/`.
- The stock terminal has independent Upstox OAuth connection controls, instrument search/watchlists, charts and indicators, cash-equity MARKET/LIMIT ticket, portfolio/history, futures, options and margin-preview surfaces.
- The terminal's gateway URL metadata is blank in the checked-in HTML. Live provider requests therefore remain intentionally unavailable until a verified gateway deployment is configured.
- Supabase-native gateway routes currently include account, watchlist, cash-equity MARKET/LIMIT orders and cancellation, portfolio/history, options, futures MARKET orders, futures portfolio/history, and margin preview.
- Futures LIMIT orders are explicitly rejected until the protected LIMIT worker is available.
- The current frontend exposes chart indicators and drawing controls; their complete live-data behavior must be validated against the deployed feed rather than inferred from UI presence.
- The core Supabase migrations are draft-only. The SQL schema uses `auth.users` identities, integer paise, separate Delivery/Intraday equity positions, derivative positions, futures positions/orders, private watchlists and RLS.
- The checked-in compliance note states that public real-time market-data launch is not approved until written provider permission and Indian legal review are obtained. Do not bypass this gate.

## Scope order — Indian market first

1. **Cash equities:** NSE/BSE instrument master, verified quotes/candles, watchlists, charts, indicators, Delivery and Intraday MARKET/LIMIT lifecycle, reservations, cancellation, fills, portfolio valuation, P&L and order/trade history.
2. **Futures:** contract validation, margin preview, MARKET paper execution, charges, margin reservation/release, position lifecycle, expiry handling, portfolio and history. Futures LIMIT remains disabled until a separately tested worker/lifecycle is ready.
3. **Options:** NSE/BSE CE/PE contract validation, long-option BUY and SELL-to-close only, lot/tick/expiry/strike integrity, charges, cash accounting, portfolio valuation and history. Short-option writing remains disabled unless a separately approved risk/margin model is implemented.
4. **Risk controls:** server-side stop-loss/target lifecycle and session-aware controls. Do not describe client-side display controls as guaranteed server execution.
5. **Release validation:** complete CI, staging migration rehearsal, authenticated multi-user isolation, concurrency/idempotency, rollback, observability, mobile/browser regression and provider/legal sign-off.

## Explicit sequencing guardrails

- Do not develop, deploy, merge or apply Crypto-specific changes while Indian-market work is the active priority.
- Keep the separate Crypto draft PR and its branch intact as parked work; do not delete or merge it as part of this sequencing change.
- Do not apply draft migrations to the linked production Supabase project or import/overwrite customer data.
- Do not activate a public real-time feed or production gateway until the documented market-data rights gate is satisfied.
- Do not enable a UI action unless its backend lifecycle and tests exist; fail closed with a clear message instead.
- ZENURA IGNITE has one user-facing mode: Paper Trading. Indian Stock Market is the only active development scope; Crypto is parked and must not be modified until Indian-market release gates are met. Paper Investing is retired.

## Current verified gaps / release blockers

- No staging deployment evidence is recorded in this integration branch's inspected documentation.
- The checked-in stock terminal has an empty gateway URL; deployed endpoint, secrets, CORS and OAuth callback configuration remain to be verified.
- Futures LIMIT is explicitly not enabled.
- Server-side always-on stop-loss/target execution is not evidenced by the inspected stock gateway routes.
- Public real-time market-data rights and legal applicability remain unapproved per `MARKET-DATA-COMPLIANCE.md`.
- Production migration and rollout remain blocked pending reviewed staging evidence, rollback plan and explicit approval.

## Working method

Work only on the Indian-market integration branch and its isolated stock/gateway/migration/test files. Make additive, independently tested changes. After each coherent increment, run targeted tests and the full gateway/CI suite, review the exact diff, and record remaining blockers. Keep Crypto untouched until the Indian-market release gates are met.

## Current engineering status and next gate

The equity protective-order slice is now implemented in this integration branch:

- A dedicated protective-worker lease and bounded scan/cursor processing are separate from the LIMIT worker.
- The worker validates official NSE/BSE cash-equity instruments, exact quote identity and freshness, owner/position state, and deterministic execution identity.
- Atomic SECURITY DEFINER RPCs create, cancel and fill equity protective orders with row locking, idempotency and reserved-share accounting.
- Worker orchestration tests cover fills, stale quotes, unsupported instruments, expired provider tokens, lease contention and cancellation/fill races.
- The worker remains **opt-in and disabled by default**. The creation API fails closed when it is disabled. This does not establish production availability or guaranteed always-on execution.
- Futures and long-option protective exits remain unsupported and must not be routed through the equity worker.

The Intraday LIMIT lifecycle is now implemented in the draft integration branch, with its user-facing execution path still opt-in and disabled by default:

- Forward-only SQL migration `20261123040000_paper_intraday_limit_reservations.sql` adds separate BUY cash and SELL share reservations, idempotent submission, atomic fill, cancellation and IST session-expiry handling.
- The dedicated worker uses bounded batches/cursor rotation, verified NSE/BSE cash-equity instruments, exact instrument quote matching, a 15-second quote-age limit and a separate worker lease key. Delivery LIMIT behavior remains isolated.
- The gateway accepts Intraday LIMIT only when `PAPER_INTRADAY_LIMIT_WORKER_ENABLED=true`; the default remains disabled and the endpoint fails closed.
- The first implementation exposed a lease allowlist mismatch: the existing lease RPC accepted only Delivery LIMIT and protective-worker keys. Forward-only migration `20261123043000_intraday_limit_worker_lease_key.sql` now registers the Intraday LIMIT key for acquire/release without changing the other workers.
- SQL reservation/fill/expiry tests and worker orchestration tests are present. Additional CI regressions now cover worker lease ownership/exclusivity and concurrent BUY fill-vs-cancel / SELL cancel-vs-fill races.
- GitHub Actions run [45072069229](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45072069229) passed on commit `fff83799b1a47a18bafa6096c0c760d5d76ed8f5`. This includes the worker-lease ownership/exclusivity SQL regression and the concurrent BUY fill-vs-cancel / SELL cancel-vs-fill regression. The first race-harness attempt exposed Bash expanding PostgreSQL dollar-quote delimiters; the harness now escapes those delimiters and the complete CI run is green.

- A subsequent full GitHub Actions run [45072317000](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45072317000) passed on commit `ce735d456a7fd35cbaf2b2178b3614068491bf15`, including the updated charge-calculation regression suite and the complete market-gateway tests.
- The NSE charge module now separates the 1 March 2026 transaction component from the ₹0.01/crore IPFT contribution. NSE option IPFT was corrected to ₹0.01/crore rather than the earlier overstated value. These remain indicative standalone calculations and are not yet wired into cash-equity settlement.
- NSE cash-equity MARKET orders now settle brokerage, exchange transaction/IPFT, SEBI, STT, stamp duty, estimated DP and GST atomically. BUY fees are added to cost basis and debited from cash; SELL fees reduce proceeds and net realized P&L. Orders persist a versioned charge breakdown and signed cash delta. Tiny Delivery SELLs with non-positive net proceeds fail closed.
- Delivery LIMIT and Intraday LIMIT now reserve estimated BUY charges at the limit price, settle actual fill charges atomically, update fee-inclusive cost basis/net realized P&L and release unused reservations. Cancellation and IST expiry continue to release the full stored reservation. Tiny Delivery LIMIT SELLs that cannot cover minimum charges are rejected before share reservation.
- The order book and trade-history UI now show total charges and realized P&L. The Supabase order-history API returns the charge breakdown and cash delta.
- At the earlier fee-aware LIMIT checkpoint, Delivery and Intraday LIMIT workers were fail-closed for BSE cash instruments. The forward-only LIMIT fee migration still refuses to apply while any PENDING or PARTIALLY_FILLED LIMIT order remains, so pre-migration gross-only reservations must be drained first.
- Full GitHub Actions run [45075536857](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45075536857) passed on the fee-aware MARKET/LIMIT branch, including market-gateway regression tests, disposable PostgreSQL migrations, fee settlement vectors, reservation/cancel/expiry tests, concurrency races, and F&O follow-on accounting checks.
- Added an NSE cash-equity Intraday charge estimator in integer paise: brokerage is capped at ₹20 or 0.10% turnover, STT is sell-side 0.025%, stamp duty is buy-side 0.003%, plus NSE transaction/IPFT, SEBI and GST. At that earlier checkpoint, BSE intraday remained fail-closed pending exact scrip-group pricing; the later BSE fee-master integration below supersedes that restriction.
- BSE pricing was checked against the official [BSE Equity Segment Master Circular](https://www.bseindia.com/markets/MarketInfo/DownloadAttach.aspx?attachedId=8a7fec3a-95bc-4bd2-82de-76e2a84e2915&id=20250429-51): cash transaction fees depend on scrip group and, for some groups, the BSE-exclusive flag from the exchange scrip master. The currently downloaded Upstox instrument-master records do not expose those required fields, so BSE cash settlement remains fail-closed rather than guessing a rate.
- Added forward-only migration `20261122214500_align_option_charges_with_nse_ipft_schedule.sql` to correct the long-option SQL fee constants to NSE transaction 0.0003552 plus IPFT 0.000000001. The previous combined/overstated SQL constants would have diverged from the JavaScript calculator at larger turnovers.
- Added a CI guard that inspects the installed option RPC definition for the corrected SQL constants. The complete GitHub Actions run [45074654262](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45074654262) passed after the option and equity fee-accounting regressions were aligned.
- The new Intraday calculator and the option SQL correction are still not connected to cash-equity MARKET/LIMIT settlement. That atomic accounting integration remains the next engineering gate.

Remaining before this slice can be marked release-ready:

1. Rehearse all forward-only migrations and worker leases against a disposable Supabase staging database, including a preflight with open LIMIT orders drained; do not use the linked production project.
2. Complete operational BSE support by importing and validating a full, current official scrip-group/exclusive-flag master and complete verified session calendars. The branch now supports BSE cash MARKET, Delivery LIMIT and Intraday LIMIT when those snapshots are present; P/ZP and unknown groups remain blocked.
3. Validate end-to-end account/order reconciliation in staging after BUY, SELL, cancellation, expiry, idempotent replay and worker races. LIMIT currently fills an order atomically as a whole; do not claim partial-fill support until a separately tested partial-fill lifecycle exists.
4. Complete futures/options charge, margin, expiry and portfolio reconciliation against the same fee-aware account ledger, then run mobile/browser regression and observability checks.
5. Keep public market-data access and live worker/UI enablement blocked until provider rights, legal review, staging evidence and rollback gates pass.

The existing Delivery LIMIT worker must not be reused as an Intraday implementation by simply removing its product filter. The separate reservation, session-expiry, cancellation and fill invariants are required.

## Latest Indian-market continuation — 2026-11-23

This section supersedes the earlier BSE fail-closed status notes above.

- Added the BSE standardised scrip-master parser and service-role-only import path. It records source date, exact file SHA-256, official BSE source URL, ISIN, scrip group, instrument status/type and BSE-exclusive flag. Imports reject stale, duplicate, malformed, unsupported or non-provenanced records.
- Added the BSE group-specific cash-equity fee resolver using the official BSE Equity Segment Master Circular dated 29 April 2025. Published rupee-per-crore rates are converted to paise with integer-safe arithmetic; the BSE IPF component is included in the exchange rate. Some groups are invoiced on monthly turnover, so the paper ledger records an indicative per-fill allocation, not the final month-end exchange invoice. P/ZP groups remain blocked because the demat-offset classification is not modelled; unknown groups fail closed. BSE charges are marked indicative and simulation-only.
- Added fee-aware BSE cash MARKET, Delivery LIMIT and Intraday LIMIT settlement. BUY reservations include estimated charges; fills use actual execution-price charges; SELL proceeds, fee-inclusive cost basis and realized P&L are settled atomically.
- Enabled BSE Delivery and Intraday LIMIT worker eligibility only for matching BSE_EQ instruments and BSE-verified session rows. NSE orders cannot reuse BSE sessions and vice versa.
- Added a verified NSE/BSE session-calendar CSV importer. It records the exact CSV SHA-256, requires official HTTPS exchange hosts, validates REGULAR/SPECIAL/CLOSED windows and verification timestamps, and invalidates omitted dates for each exchange represented in a new complete snapshot. Intraday LIMIT SQL and gateway loaders now reject sessions without a valid imported snapshot hash.
- Added BSE fee-master, BSE MARKET/Delivery LIMIT/Intraday LIMIT, session-import, BSE worker-policy, session-loader and concurrency regressions. The BSE exchange rate conversion is covered in rupees-per-crore and paise-per-crore units, including full cash/fee/P&L vectors. GitHub Actions run [45078985239](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45078985239) passed on commit `2b12bbfd5169f34478ebbc7c64a6417a95e6cf85`.
- Draft PR #83 remains open and unmerged. The BSE fee-master, BSE settlement, session-import and verified-session guard migrations are not applied to the linked production Supabase project. No customer data was changed.
- BSE is not operationally enabled merely by these code changes: a complete current official BSE scrip-master snapshot and verified NSE/BSE session snapshots must be imported first. The public real-time data rights/legal gate, gateway deployment configuration and staging rehearsal remain unchanged.

## Latest continuation checkpoint — 2026-11-23

- Hardened both BSE scrip-master and NSE/BSE exchange-session CSV parsers to reject non-whitespace trailing characters after a closing quoted field, while retaining escaped quotes and multiline quoted-field handling.
- Added regression cases for malformed quote suffixes and misplaced quotes in both import formats.
- Added a regression guard for the BSE standardized scrip-master 2026 CAS marker at field 24, ensuring it does not shift the existing group, exclusive-flag or instrument-type interpretation.
- GitHub Actions run [45081167072](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45081167072) passed on commit `e4df4bbbc694fd4496cec57def7aac19cdb83373`. The full job completed all 50 numbered validation steps successfully, including production-image build, Firebase-absence check, full gateway regression suite, disposable PostgreSQL migration rehearsal, BSE fee-master/session imports, RLS, account isolation, fee settlement and concurrency/race checks.
- PR #83 remains draft, open and unmerged. No production migration, gateway deployment, BSE master import or customer-data change was performed.

### Next safe engineering gates

1. Obtain and validate complete current official BSE scrip-master and verified NSE/BSE session-calendar snapshots before enabling BSE fee-dependent orders or Intraday LIMIT workers in any shared environment.
2. Complete a separately approved Supabase staging rehearsal with preflight confirmation that no pending/partially-filled LIMIT orders would block the forward-only fee migration; capture rollback and account/order reconciliation evidence.
3. Close futures/options ledger reconciliation gaps and explicitly keep Futures LIMIT, F&O protective exits and untested partial-fill behavior disabled.
4. Complete equity protective-order creation UI/API end-to-end validation before enabling the opt-in worker.
5. Obtain written provider market-data permission and Indian legal review before public real-time data access or production deployment.

Do not infer operational readiness from green disposable-database CI. The empty frontend gateway URL, disabled opt-in workers, unimported verified exchange snapshots, missing staging evidence and unresolved data-rights gate remain release blockers.

## Protective-order UI integration checkpoint — 2026-11-23

- Added isolated frontend module `markets/stocks/protective-orders.js` and loaded it from the Indian stock terminal without changing the existing MARKET/LIMIT order workspace.
- The module provides authenticated create/list/cancel flows for NSE/BSE cash-equity Delivery and Intraday protective exits, Stop-Loss/Target trigger input, account-scoped retry idempotency, account-switch clearing, safe text-only rendering and Hindi/English synchronization.
- Creation controls remain disabled unless the authenticated gateway reports `workerEnabled=true`; the gateway itself rejects creation with HTTP 503 when its protective worker is disabled. The backend independently verifies that the selected instrument is an official NSE/BSE cash equity.
- Added dedicated UI contract tests and included the new module in the JavaScript syntax-check command.
- GitHub Actions run [45081736573](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45081736573) passed on commit `cf9c7d37c787fbdce50b5bf363c4ca38b348161c`. All 50 numbered validation steps passed, including the full gateway regression suite, disposable PostgreSQL migrations, BSE/session import tests, protective fill/cancel concurrency race and schema/RLS checks.
- The UI integration does not enable the worker or constitute a browser-to-staging end-to-end rehearsal. Keep the worker disabled until the staging trigger/cancel flow, data-rights and release gates are reviewed.

## Read-only Supabase runtime privilege audit — 2026-11-23

- The only connected Supabase project is `zenura-paper-trading` (`atvbjibhunvzpmfagagm`), currently `ACTIVE_HEALTHY`; it has no Supabase development branches. Its applied migration history currently ends at `20261122123415`, so the later BSE fee-master, verified-session import and protective-order migrations in PR #83 are not applied there.
- No schema changes were made during this audit. The database contains zero rows in the inspected Paper Trading account/order tables.
- Read-only privilege checks found that database role `service_role` currently has no SELECT privilege on `upstox_connections`, `paper_market_worker_state`, `paper_orders`, `paper_protective_orders` or `paper_equity_positions`; it also has no UPDATE privilege on the worker-state/protective-order tables. The current gateway/worker code directly reads or updates those tables using the service-role client.
- This is a release-blocking runtime privilege mismatch even though disposable PostgreSQL CI passes: Upstox connection lookup and server-side Delivery LIMIT, Intraday LIMIT and protective-worker scans/cursor operations can fail against the currently linked database until narrowly scoped grants are added and verified.
- Supabase Security Advisor also reports six RLS-enabled internal tables without policies. This is informational only if they remain inaccessible to `anon`/`authenticated`; the direct service-role privilege gap above is the actionable finding.
- There is no staging branch available to rehearse the corrective migration. Do not grant privileges or apply a migration directly to the linked project. Create/use a disposable Supabase staging branch only after its cost and approval are confirmed; then add the minimal service-role grants, verify all direct access paths, run advisors, and rehearse the complete migration chain there.
