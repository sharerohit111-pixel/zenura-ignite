# S-TRADE User Accounts & Wallet Audit

Date: 2026-11-24  
Repository: `sharerohit111-pixel/zenura-ignite`  
Base: `feature/indian-market-backend-infra-supabase-2026-11-23`  
Scope: Supabase-native Indian-market account UI, authentication, profile, session and wallet projection.  
Excluded: Crypto, production migration, deployment, staging writes, and live account operations.

## Existing implementation verified

- Browser client uses the Supabase publishable key and persists/refreshes Supabase Auth sessions.
- Email registration uses `supabase.auth.signUp`; email login uses `signInWithPassword`; logout uses `signOut`.
- Gateway validates bearer tokens through server-side `auth.getUser(token)`; malformed/non-UUID identities are rejected.
- User-facing account reads use the verified user's JWT and the publishable key, so PostgreSQL RLS remains in force.
- Server-side account initialization injects the verified Supabase UUID. Client-provided `p_user_id` is rejected by the runtime allowlist.
- `initialize_paper_trading_account` creates ₹10,00,000 (100,000,000 paise) once, uses `ON CONFLICT DO NOTHING`, serializes concurrent retries, and does not reset existing balances, reservations, positions or P&L.
- The existing disposable PostgreSQL workflow tests account initialization/retry and cross-user account visibility. `supabase/tests/rls_permissions.sql` checks the authenticated grant boundary and own-row watchlist/chart-drawing isolation; the migration workflow also checks the broader account/position/order tenant boundary.

## Changes in this branch

1. Added an isolated responsive account-settings module to the S-TRADE workspace.
2. Added Supabase SMS OTP send/verify flow using E.164 phone input and `verifyOtp(type: "sms")`. It supports account creation through the Supabase Phone provider; project-level Phone/SMS provider configuration remains an external prerequisite.
3. Added display-name profile editing through the signed-in user's own Supabase Auth metadata.
4. Added session refresh, auth-state synchronization, logout, and clearing of displayed wallet values when the active account changes or signs out.
5. Added a private wallet snapshot panel for starting capital, cash, blocked funds and available funds.
6. Added integer-paise wallet projection validation in `market-gateway/lib/paper-wallet.js`; it rejects negative, fractional, unsafe or inconsistent balances. The gateway still reads `paper_accounts` through the authenticated user's JWT/RLS.
7. Added frontend and gateway regression tests and wired the account module test into the disposable migration workflow.

## Wallet formula currently exposed

- Starting capital = `starting_cash_paise`
- Wallet cash = `cash_paise`
- Blocked funds = `reserved_cash_paise + reserved_margin_paise`
- Available funds = `cash_paise - blocked_funds`

All values are integer paise; the UI converts them to INR for display. The response explicitly reports `walletSource: "paper_accounts"` and `ledgerReconciled: false`. This is an account-state projection, not a claim that the wallet is already ledger-reconciled.

## Blocking ledger integration finding

The current canonical integration baseline does not contain one complete cross-asset wallet ledger contract. The equity cash-ledger implementation is still in Draft PR #100 (built on PR #92); PR #100's own description says its exact current head still needs fresh CI and full portfolio reconciliation remains follow-up. Futures and Options use their own accounting/ledger workstreams. A single wallet cannot safely sum only the Equity ledger or infer a unified balance from partial draft ledgers.

The cross-chat database owner (Chat 7) must approve one canonical migration chain and ledger contract before this branch can query/aggregate ledger rows. The canonical migration plan also records version collisions and requires a full disposable PostgreSQL migration chain before adoption. Do not duplicate or renumber those migrations here.

Required next ledger phase:
- Agree on a canonical append-only wallet/cash event interface across Equity, Futures and Options, with asset-family source references and unique idempotency keys.
- Preserve the existing account row as the transactionally locked spendable-balance authority until the ledger owners approve the reconciliation transition.
- Add server-only, verified-user wallet summary RPC (no browser direct ledger access), deriving available/blocked balances from the same transactionally consistent account + ledger snapshot.
- Add per-user ledger RLS/ACL tests, service-role least-privilege checks, append-only UPDATE/DELETE denial, cross-tenant FK checks, replay/idempotency and cash-conservation tests.
- Run the complete ordered migration chain from empty disposable PostgreSQL and reconcile every asset-family ledger against `paper_accounts` before calling the wallet complete.

## Auth and account release gates

- Enable and configure Supabase Phone Auth and an approved SMS delivery provider; test Indian +91 delivery, OTP expiry, resend throttling, invalid/expired codes, duplicate registration, and account recovery.
- Test email registration/verification, password login, SMS OTP login, refresh, expiry, logout, and cross-account state clearing in browser tests.
- Test account creation under concurrent first login, ensuring exactly one ₹10,00,000 grant.
- Test RLS for two authenticated users against accounts, orders, positions, watchlists and all ledger tables; no authenticated direct write to account balances or immutable ledgers.
- No production Auth migration, Supabase schema migration, production deployment, or Crypto change is included.

## Validation status

Source and workflow wiring are committed for CI. This environment has not run the GitHub Actions workflow or a disposable PostgreSQL instance; do not treat the new tests as passed until CI reports success on the exact PR head.