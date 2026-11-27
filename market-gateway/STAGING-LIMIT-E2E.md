# Paper Trading LIMIT Orders — Staging E2E Runbook

## Purpose and release gate

This runbook verifies the cash-equity paper LIMIT order lifecycle against an isolated Firebase/Firestore staging project and a staging Cloud Run gateway. These are simulations only; no broker or exchange order may be submitted.

**Do not run against production. Do not merge PR #28 or PR #26. Do not deploy the LIMIT worker unless a separate, explicit staging deployment approval has been given.** The default Firebase deployment remains restricted to the four Upstox connection Functions; the scheduled worker is excluded.

## Staging prerequisites

- Create/confirm a dedicated Firebase project and Firestore database used only for staging. Do not use `.firebaserc`'s current `default` project (it points to the production project).
- Create a dedicated Cloud Run staging service in the same staging project, with a dedicated least-privilege service account. Do not grant Owner/Editor.
- Configure staging-only secrets: Upstox client ID/secret, exact staging callback URL, and a newly generated 32-byte token-encryption key. Store secrets in Secret Manager only.
- Configure the gateway with the exact staging web origin, `INDIAN_PAPER_STARTING_CASH_PAISE=100000000`, and the staging encryption-key secret. Never use a wildcard CORS origin.
- Use two disposable, verified staging users with separate Upstox test/authorized accounts. Never use customer accounts or production tokens.
- Verify the gateway health endpoint, Firebase ID-token authentication, Firestore IAM access, instrument-master lookup, and quote retrieval before order tests.
- Keep the staging worker undeployed until the non-worker checks pass and the separate worker deployment approval is recorded.

## Test data and invariants

Use one liquid NSE/BSE cash-equity instrument from the official instrument master, with its verified tick size. Record the instrument key and test timestamps. Each test user starts with the configured ₹10,00,000 virtual cash only once.

For every test, capture before/after values for:
- `cashPaise`, `reservedCashPaise`, `reservedMarginPaise`
- `positions[instrumentKey].quantity` and `reservedPositions[instrumentKey]`
- order ID, status, limit/execution price, timestamps, and idempotency replay flag

At all times, available cash must equal cash less reserved cash and reserved margin; available shares must equal held shares less reserved shares. A user's orders and balances must never be visible to the other user.

## Phase A — staging gateway without the scheduled worker

1. **Authentication and account isolation:** unauthenticated requests to `/paper/account`, `/paper/orders`, and cancellation must be rejected. User B must not be able to read or cancel User A's order.
2. **LIMIT BUY reservation:** submit a valid LIMIT BUY with a UUID v4 idempotency key and tick-size-aligned `limit_price_paise`. Expect HTTP 201 and `PENDING`; reserved cash must increase by limit price × quantity, available cash must decrease by the same amount, and holdings must not change.
3. **Insufficient cash:** submit a BUY whose reservation exceeds unreserved cash. Expect rejection with no order document and no balance/reservation mutation.
4. **LIMIT SELL reservation:** first establish a paper holding, then submit a LIMIT SELL. Expect reserved shares to increase and available shares to decrease; total held shares and cash must not change.
5. **Insufficient shares:** attempt to reserve more unreserved shares than held. Expect rejection and no mutation.
6. **Duplicate request:** resend the exact same LIMIT request with the same idempotency key. Expect the original order ID/status and no second reservation. Reuse that key with a different instrument, side, quantity, or limit price; expect HTTP 409 and no mutation.
7. **Cancellation:** cancel a pending BUY and a pending SELL separately. Expect `CANCELLED`, `reservationReleased: true`, and exact release of cash/shares without changing the underlying holding or cash balance. Repeat cancellation; expect an idempotent `CANCELLED` response and no additional release.
8. **Invalid cancellation:** cancellation by another user, for a MARKET order, or for a filled order must fail without changing either account.
9. **Order history and frontend contract:** verify `GET /paper/orders` returns the expected order fields and cursor pagination; verify `GET /paper/account` returns `cashPaise`, `reservedCashPaise`, `reservedMarginPaise`, `positions`, and `reservedPositions`. Confirm the staging frontend uses the exact verified gateway URL and Firebase project.
10. **Market-order interaction:** while cash/shares are reserved by pending LIMIT orders, attempt MARKET BUY/SELL orders. The transaction must use only unreserved funds/shares and must not consume another pending order's reservation.

## Phase B — worker and quote execution (separate staging approval required)

Only after Phase A passes, request explicit approval to deploy **only** `functions:processPendingPaperLimitOrders` to the named staging Firebase project. Never deploy all Functions and never target the production project.

1. **BUY trigger:** with a pending BUY, observe a fresh verified quote at or below the limit. Expect one simulated fill at the server-observed quote, status `FILLED`, reservation release, and correct cash/position update.
2. **SELL trigger:** with a pending SELL, observe a fresh verified quote at or above the limit. Expect one simulated fill, reserved-share release, reduced holding, and correct cash proceeds/P&L.
3. **Not reached:** a fresh quote on the wrong side of the limit must leave the order `PENDING` and preserve its reservation.
4. **Stale/invalid/future quote:** the worker must not fill; the order and reservation remain unchanged. The deterministic stale/future quote cases are also required in automated tests because a live provider does not offer a safe way to force arbitrary timestamps.
5. **Duplicate processing and race:** overlapping worker invocations, retry after a successful fill, and cancellation racing with worker execution must never double-fill or release a reservation twice. Final order status and account mutations must be consistent with exactly one winning transaction.
6. **Provider failure:** a failed quote request must leave the order pending and reserved, log a bounded operational warning, and allow later orders in the batch to be processed.
7. **Market-session guard and operations:** verify no execution outside the configured Indian cash-market session; confirm worker concurrency/instance limits, logs, failure alerting, and a documented disable/rollback procedure.

## Required automated regression coverage

Before Phase B, CI must remain green for:
- BUY/SELL threshold logic, tick/price validation, stale, invalid and future quotes
- BUY cash and SELL share reservation; insufficient balance/holdings
- cancellation release, repeated cancellation, ownership checks, inconsistent reservation rejection
- idempotency replay and mismatched-payload conflict
- worker retry, provider failure isolation, cursor rotation, and transaction atomicity
- Firestore Emulator integration tests for the reservation/fill/cancel transaction paths

If any required path is not covered by an Emulator-backed test, record it as a test gap; do not treat a pure in-memory unit test as equivalent to an Emulator integration test.

## Sign-off record

Record the staging project ID, gateway URL, tested commit SHA, test user IDs (non-sensitive aliases only), instrument key, test results, worker deployment approval reference, and operator/date. Do not record access tokens, secrets, or personal customer data.

Release remains blocked until all checks pass, the staging evidence is reviewed, and a separate deployment approval is provided.
