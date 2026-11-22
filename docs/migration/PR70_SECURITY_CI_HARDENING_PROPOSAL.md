# PR #70 — Security CI Hardening Proposal

**Purpose:** Proposed follow-up for PR #70 after the 2026-11-22 read-only review.  
**Status:** Proposal only; not applied to PR #70 or any Supabase project.  
**Target validation environment:** Disposable PostgreSQL 16 harness only.

## Required privilege matrix

The current smoke workflow successfully exercises transaction routines, but most trading calls execute as the configured PostgreSQL superuser. A superuser bypasses normal function ACL checks, so those calls do not establish that the service-role boundary works.

| Capability | anon | authenticated | service_role |
|---|---:|---:|---:|
| Execute account initialization, MARKET, LIMIT and long-option RPCs | Deny | Deny | Allow |
| Read own account/positions/orders | Deny | Allow via RLS | Backend only |
| Read another user's account/positions/orders | Deny | Deny via RLS | Backend only |
| Directly write accounts/positions/orders | Deny | Deny | Backend only |
| Directly CRUD own watchlists | Deny | Allow via owner RLS | Allow |
| Read/write identity map, OAuth/token, lease/worker/rate-limit state | Deny | Deny | Backend only |

Backend only means the service credential or trusted function owner, never a browser client. If the project chooses a different Data API exposure model, validate equivalent effective grants and RLS behavior rather than relying only on this table.

## Suggested SQL privilege assertions

Run after applying migrations as the harness administrator. Keep signatures synchronized with the actual migration definitions.

```sql
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.initialize_paper_trading_account(uuid)',
    'public.execute_paper_market_order(uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint)',
    'public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)',
    'public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)',
    'public.cancel_paper_limit_order(uuid,text)',
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'
  ] LOOP
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', fn;
    END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE')
       OR has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('PUBLIC', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Untrusted role has EXECUTE on %', fn;
    END IF;
  END LOOP;
END
$$;
```

Note: PUBLIC is a pseudo-role. If the harness version does not accept it in this context, inspect aclexplode(coalesce(proacl, acldefault('f', proowner))) from pg_proc and assert that no PUBLIC/anon/authenticated EXECUTE ACL remains.

## Suggested authenticated RLS test

Create two users and their paper accounts as the harness administrator or service role. Then switch to authenticated, set the JWT subject to user A, and assert:
- A sees exactly A's account.
- A cannot see B's account.
- A cannot update either account directly.
- A cannot insert/update/delete orders or positions directly.
- A cannot read or write identity mapping, OAuth state, encrypted connection, lease, worker cursor or margin-rate state.
- A can create/update/delete only their own watchlist rows.
- A cannot insert/update a watchlist row with user B's UUID.

Use SET LOCAL ROLE authenticated and transaction-local JWT claim settings. Test a second transaction with user B. Do not treat a superuser's RLS behavior as evidence.

## Run business-logic tests under the intended role

Run transaction lifecycle tests after SET ROLE service_role, not as postgres superuser. Keep a separate negative test that attempts the same RPC under authenticated and anon and expects permission denial.

## Additional high-value tests

1. Identity substitution: trusted API derives Supabase UUID from a verified Firebase token; browser-supplied user IDs are ignored/rejected.
2. Concurrency: two MARKET BUY requests with the same idempotency key; LIMIT fill racing cancellation; two workers attempting one pending LIMIT fill.
3. Reservation conservation: repeated cancel/fill/replay never releases cash or shares twice; terminal records retain historical reservation audit values without retaining active account reserves.
4. Option ledger parity: compare every fee component, fee-inclusive basis, partial close allocation and negative net credit against Firebase implementation.
5. Provider boundary: stale/future quote, wrong instrument key, wrong lot/tick/expiry and caller-injected price are rejected by trusted adapter before the RPC.
6. Watchlist normalization: duplicate keys, malformed keys, empty values, allowed names, and 50-item limit match existing Firebase normalizer.

## Acceptance criteria

- All migration SQL applies in disposable PostgreSQL 16.
- Role matrix assertions pass with no superuser used for actual RPC permission checks.
- Cross-user RLS tests pass for all exposed user data.
- Direct write attempts to server-owned tables fail for anon/authenticated.
- All business-logic tests pass under service_role.
- Concurrency and Firebase differential tests pass.
- No test requires production Firebase or the connected Supabase project.

No staging or production migration is implied. A staging rehearsal requires separate explicit approval after findings are closed.
