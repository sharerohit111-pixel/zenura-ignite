# S-TRADE Chat 53 — Security & Account Isolation Master Verification

**Audit date:** 2026-11-25  
**Canonical base branch:** `integration/s-trade-round1-ledger-consolidation-2026-11-25`  
**Canonical base SHA:** `6082d19ece570921a3d7b07d0d97042edc1a27c2`  
**Audit branch:** `security/chat53-master-verification-2026-11-25`  
**Disposition:** PARTIAL — NOT RELEASE READY

## Scope and safety

This record covers S-TRADE only. No production migration, deployment, merge, live broker connection, real credential use, or Crypto source/configuration modification was performed. No secret values or secret fingerprints are reproduced here.

## Canonical and candidate lineage

- Canonical base was cross-checked against PR #232's base and a GitHub compare operation.
- PR #232 is Draft, based on the canonical SHA above, with candidate head `41154e88701cc64c7fd8d591d0d2b58eaaaf6b73`.
- PR #224 is Draft but targets the older base `feature/s-trade-round3-equity-demo-screen-integration-2026-11-24` at `66e55be48cef99bf4eb1a71b3a6b826fbdbb2574`; it is not a canonical-head security PASS.
- PR #224's security workflow code was inspected at head `284ca9d8373cdcc90b42fcc28870d8af0982037c`.

## Evidence ledger

| Area | Result | Evidence / limitation |
|---|---|---|
| XSS / DOM sinks | PARTIAL | Static inspection of `markets/stocks/demo.js`, `markets/stocks/email-auth.js`, and `markets/stocks/demo-watchlist-persistence.mjs`. Dynamic Demo rendering predominantly uses `textContent` and DOM node construction. The auth form's `innerHTML` is a fixed literal template, not interpolated user input. No complete adversarial XSS browser suite was demonstrated. |
| CSP | BLOCKED | `markets/stocks/index.html` has no CSP meta policy. The restrictive CSP added in PR #224 applies to the isolated synthetic Demo page only. Authenticated workspace response headers / gateway-origin policy remain unverified. |
| Dependency audit | PARTIAL | PR #224 head `284ca9d8373cdcc90b42fcc28870d8af0982037c`: Functions and Market Gateway `npm audit --audit-level=high` jobs reported success. Workflow resolves temporary lockfiles; committed lockfile reproducibility is not established. |
| Secret scan | FAIL | PR #224 full-history Gitleaks job reported three unresolved `gcp-api-key` findings: two in root `firebase-config.js`, one in `crypto/firebase-config.js`. The scan exited 1. These are treated as client Firebase API-key findings, not service-account credentials. Firebase API restrictions/referrer restrictions were not verified. Crypto finding was left untouched. |
| Browser storage | PARTIAL | Supabase client configuration persists sessions and enables token refresh with PKCE. Private watchlist is loaded through authenticated Supabase queries. Full browser-profile, restart, logout, cache and account-switch storage inspection remains incomplete. |
| Stale responses | PARTIAL PASS | Candidate watchlist controller includes request-version invalidation and account reset. Existing connector includes auth-sequence/session identity checks. No full live-network race test for every private screen is evidenced. |
| Watchlist A/B | CI PASS (test double) | PR #232 Demo Screen Wiring run #673 passed. The deterministic browser test exercises A/B account switching and session clearing, but uses a Supabase test double rather than two hosted accounts. |
| Supabase RLS | CI PASS (disposable DB) | PR #232 SQL smoke run #2267 passed on disposable PostgreSQL. Checks include RLS enablement, browser-role grants, tenant isolation for account/positions/orders/watchlists, and privileged RPC boundaries. Hosted Supabase A/B proof is still absent. |
| Dashboard / Orders / Portfolio | NOT VERIFIED | Demo smoke renders 15 screens, but the authenticated private account data paths for all requested screens have not been proven isolated with two real accounts. |
| Browser UI regression | CI PASS (candidate) | PR #232 run #673 log: 88 Node assertions, 0 failures; desktop, Android-sized and small-mobile smoke; axe serious/critical violations 0; offline fixture smoke passed. These are candidate-head results, not canonical-head results. |

## Important source observations

- `markets/stocks/index.html` currently has no CSP meta directive. It loads same-origin scripts/modules and uses a configurable market-gateway meta value; a restrictive policy must account for the actual Supabase and gateway origins before enforcement.
- `markets/stocks/supabase-client.js` configures persisted Supabase sessions, automatic refresh and PKCE.
- `markets/stocks/email-auth.js` builds its form from a fixed literal HTML template. User-facing status messages are assigned with `textContent`.
- `markets/stocks/demo.js` uses DOM construction and `textContent` for the inspected screen/table rendering.
- `markets/stocks/demo-watchlist-persistence.mjs` scopes saved watchlist rows to the current authenticated UID, invalidates stale requests, clears view state on account change, and unsubscribes its auth listener on cleanup.
- `supabase/migrations/20261122120716_paper_trading_authenticated_rls_grants.sql` grants the minimum browser table privileges while relying on RLS as the row authorization boundary. Its comments refer to Firebase-authenticated JWTs, while the inspected current browser client uses Supabase Auth; reconcile this documentation drift before future auth-provider changes.

## Open blockers — do not mark PASS

1. Verify Firebase API key API restrictions and HTTP referrer restrictions in the Firebase project console; rotate only if required by that review. Do not alter Crypto.
2. Resolve the two non-Crypto Gitleaks findings safely; retain the Crypto finding as untouched and disclose it as out-of-scope.
3. Design and verify CSP/security headers for the authenticated workspace after enumerating required script, style, image, Supabase, WebSocket and configured gateway origins. Do not guess allowlists.
4. Run dependency audits from committed lockfiles at the canonical exact SHA and prove reproducible installs.
5. Run real authenticated User A/User B browser tests against the hosted Supabase project for Dashboard, Watchlist, Orders and Portfolio.
6. Verify logout, account switch, PWA cache and browser storage do not retain or render prior-account private data.
7. Add adversarial XSS tests and full stale-response race coverage across every private screen.
8. Re-run all required checks on the canonical SHA or on a reviewed candidate explicitly based on that SHA; never transfer PASS labels between heads.

## Release decision

**NOT RELEASE READY.** The available evidence supports candidate-level Watchlist regression and disposable-PostgreSQL RLS checks, but does not establish a canonical-head, hosted two-account security PASS. Keep `ledgerReconciled=false`. No merge or deployment is authorized by this audit record.
