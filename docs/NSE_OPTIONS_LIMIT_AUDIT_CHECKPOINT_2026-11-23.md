# NSE Options LIMIT — focused audit checkpoint

Audit base: PR #91 implementation head `7a47bb29ff6ef2683a81f16cb01f70c37fdb473a`
Audit branch: `audit/nse-options-limit-hardening-2026-11-23`
Scope: NSE long CE/PE Options LIMIT Paper Trading only. No production migration, merge, deployment, or feature activation.

## Existing implementation verified

- Dedicated `paper_option_limit_orders` and append-only `paper_option_limit_fills` ledgers.
- BUY reserves limit-price premium plus order-level charges; SELL reserves only unreserved long-position quantity.
- Existing Options MARKET SELL checks `net_quantity - reserved_quantity`.
- Separate submit, cancel, expiry and atomic fill RPCs; account → order → position lock order.
- Fill accounting uses cumulative order charges and incremental deltas; BUY cost basis includes fees and SELL realizes fee-inclusive P&L.
- Exact fill replay is checked before quote-age validation; changed execution payload is rejected.
- Worker uses a dedicated Options LIMIT lease key, bounded batch/cursor, per-user Upstox token retrieval, official instrument cache, verified NSE session and executable bid/ask depth.
- Missing verified session preserves pending orders; it does not expire them.
- RLS and service-role-only lifecycle RPC grants are present. Options LIMIT feature flags remain disabled.

## Existing test evidence observed

- PR #91 describes GitHub Actions run #1105 as passed on implementation head; following commit `7a47bb29` is documentation-only.
- Latest workflow run observed for `7a47bb29`: run #1106, completed successfully. Its PostgreSQL migration-smoke job reports success.
- Run #1106 includes completed steps for:
  - ordered draft migrations on disposable PostgreSQL;
  - Options MARKET accounting and long-option ledger reconciliation;
  - Options LIMIT submit, cash/close reservation, cancel and expiry;
  - Options LIMIT partial/full fills and accounting/reservation conservation;
  - concurrent Options LIMIT fill/cancel and duplicate-execution races;
  - Options LIMIT RLS, schema isolation and MARKET SELL reservation guard;
  - quote/expiry/contract validation, least-privilege RPC boundaries and tenant isolation;
  - complete market-gateway regression suite and production image boundary checks.
- Focused worker test file contains 10 named tests covering contract validation, expiry cutoff, session states, BUY ask/depth fill, missing session, before-open, invalid quote, lease contention, invalid batch size and per-user token isolation.
- Focused SQL accounting test covers sequential BUY and SELL partial/full fills, cumulative fee deltas, cost basis, realized P&L, exact replay and changed replay rejection.

## Focused coverage gaps / follow-up audit targets

1. The focused worker test's happy-path execution example is CE + BUY/ask. Add explicit PE happy-path and SELL/bid execution assertions, including depth-limited partial close.
2. The focused SQL accounting fixture's successful round trip is CE; PE appears in a negative-path fixture. Add a positive PE BUY/SELL round trip to prove CE/PE symmetry through persistence and accounting.
3. Confirm the Options-specific test harness exercises multiple simultaneous pending orders for the same instrument and verifies that fill/cancel/expiry release only the remaining reservation exactly once across retries. The current run has race coverage, but this targeted conservation matrix should remain explicit.
4. No staging browser-to-gateway rehearsal, provider market-data rights approval, compliance review or independent final audit is evidenced as complete. These remain release gates, not code-test substitutes.

## Safety and change policy

- No changes to Equity, Futures, Crypto, production Supabase, production flags, or deployment configuration in this audit checkpoint.
- Do not merge PR #91 or apply its draft migrations to production.
- Any follow-up implementation should add only isolated Options tests or Options-specific fixes after confirming the gap against existing code.

## Follow-up change on audit branch

- Commit `f65cb4a08f841d35c7dc34d6bddf271fd895801b` adds a focused worker regression test for a valid NSE PE SELL-to-close order. It asserts execution from best bid, bid-depth-limited partial quantity, and preservation of the exact bid/ask snapshot passed to the atomic fill RPC.
- This test addition has been committed but has not yet been executed by CI on this audit branch; no workflow run was returned for that commit. Do not treat it as passing evidence until a CI run reports success.
- Commit `3dfa9ae6484ef322d52744860058216367171f34` adds a positive-path PE BUY → full SELL-to-close SQL accounting round trip to `supabase/tests/options_limit_atomic_fill.sql`. It asserts PE position metadata, fee-inclusive cost basis, order completion, fill charges, released reservations, final cash and realized P&L reconciliation.
- Follow-up commit `8cf95a1d1cb83fb6d8011aaf6b585ab032f0b10e` corrects the expected account-level reserved cash to include the deliberately pending negative-path fixture order (`83,646` paise); the PE round trip itself must release its own reservation without disturbing that unrelated pending reservation.
- CI has not yet reported a run for these SQL test commits; the new SQL fixture is committed but remains unverified by an execution result.
