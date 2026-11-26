# Chat 68 — Physical Android, PWA and Accessibility QA Record

Date: 2026-11-26
Repository: sharerohit111-pixel/zenura-ignite
Candidate PR: #245 (must remain Draft)
Runtime source tested HEAD: 98d7c300d33a7d9307ecc14fe93542ca500f08e6
Documentation-only commit HEAD: 02838b7508a7eaaca434f1b8671da59935f9f872 (adds this QA record; no runtime files changed).
QA predecessor: PR #243, HEAD d8ca7843ad07433a9adbc039783260c6df89a8e7

## Result summary

**Physical Android release gate: BLOCKED — no physical Android device/ADB session is attached to this QA environment.**
No physical-device result is claimed as PASS. Chromium viewport emulation is not a substitute.

## Verified from repository and CI evidence

- PR #243 is open, unmerged and Draft. It consolidates Chat 60 PWA lifecycle, offline, keyboard and accessibility automation.
- PR #245 is open, unmerged and Draft. Its current HEAD is the candidate SHA above.
- On the exact PR #245 HEAD, GitHub Actions run IDs:
  - 45618048716 — S-TRADE Demo Screen Wiring Tests: SUCCESS. Includes the three Chromium viewports, all 15 demo screens, offline/reconnect, keyboard/focus, text contrast and serious/critical axe checks.
  - 45618048730 — S-TRADE Authenticated Browser Security: SUCCESS.
  - 45618048717 — Validate Indian Market Code: SUCCESS.
  - 45618048754 — S-TRADE Futures Options Demo UI Integration: SUCCESS.
  - 45618048813 — Paper Trading Supabase SQL smoke test: SUCCESS.
  - 45618048727 — Firebase read-only export tool tests: SUCCESS.
  - 45618048987 — Validate Mega Kirana Spark Backend: SUCCESS (unrelated workflow).
- Browser viewport coverage in markets/stocks/demo-browser-smoke.cjs is 1440x900 desktop, 390x844 mobile and 360x800 small mobile. It loops through 15 screens, checks horizontal overflow, keyboard order, 24x24 CSS-pixel navigation targets, text contrast in English/Hindi, and zero serious/critical axe violations.
- markets/stocks/pwa-keyboard-reconnect-qa.cjs checks service-worker activation, v11 cache presence, stale Markets cache cleanup, authorization-header probe exclusion, offline demo navigation/reload and reconnect.
- markets/service-worker.js currently uses cache generation zenura-markets-shell-v11, calls skipWaiting()/clients.claim(), deletes older zenura-markets-* caches while preserving unrelated caches, and only caches explicitly allowlisted shell assets. Requests with Authorization headers and token query parameters are bypassed; non-allowlisted navigation is not cached.
- markets/pwa-register.js registers the worker with the /markets/ scope. The manifest uses a repository-relative ./ start URL and scope.

## External device checks — NOT RUN

The following require a real Android handset and must remain NOT RUN until evidence is supplied:

1. Install from the actual hosted origin using Chrome on Android; capture install prompt/menu, installed launcher entry and standalone launch.
2. Update an older installed build to this exact candidate; record old/new app versions, service-worker controller transition, cache generation and retained user session/data behavior.
3. With airplane mode/network toggling on the handset, verify cold offline launch, navigation across all 15 screens, reload, then reconnect and verify fresh content recovery.
4. Verify old Markets cache generations are removed on-device and unrelated app caches remain untouched.
5. Inspect actual device storage/cache/network behavior to ensure authenticated responses, user data and authorization/session tokens never enter public caches.
6. Complete TalkBack checks for screen order, role/name/state/value announcements, navigation controls, dialogs, chart controls, focus restoration and language toggle.
7. Repeat responsive/layout checks on the physical handset, including portrait/landscape and system font/display scaling.

## Required evidence to close the blocker

Provide a physical Android device with:
- Device manufacturer/model and Android version/build
- Chrome version (and Android System WebView version if relevant)
- Hosted candidate URL and installed old-build version
- Screen recordings/screenshots for install, update, offline/reconnect and TalkBack
- Sanitized service-worker/cache diagnostics and network evidence (never include real tokens or personal account data)

No device identity or browser version is fabricated in this record.

## Safety / scope

- No deployment, merge, production migration or APK signing performed.
- No Crypto source/configuration modified.
- Keep PR #245 Draft until physical-device evidence and required review are complete.
- Chromium and CI results are automated evidence only; they do not close the physical Android or TalkBack gates.


## Superseding repository snapshot — 2026-11-26 16:00 UTC

A later concurrent update advanced PR #245 after the runtime CI snapshot above. The current PR head observed during Chat 68 continuation is `521953d030c517c6f8a36fdaf8b99917c7fd076b`. The manifest, registration script, service worker and two browser QA scripts were re-fetched from the current branch and their file SHAs/content remain unchanged from the previously inspected versions. The QA report itself is documentation and does not establish device evidence.

Current-head workflow snapshot:
- Run 45854558782 — Demo Screen Wiring: IN PROGRESS at inspection time.
- Run 45854558504 — Validate Indian Market Code: IN PROGRESS.
- Run 45854558788 — Firebase read-only export tests: IN PROGRESS.
- Run 45854559194 — Futures/Options Demo UI Integration: SUCCESS.
- Run 45854558619 — Supabase SQL smoke: CANCELLED.
- Run 45854558468 — Authenticated Browser Security: CANCELLED.

Therefore, the earlier SUCCESS runs listed above apply to the earlier tested runtime SHA, not automatically to this newer PR head. Do not mark current-head CI fully green until its in-progress runs complete and cancelled checks are rerun or otherwise validly satisfied. PR #245 remains open and Draft; its mergeable field was false in the latest metadata snapshot. No merge or deployment was attempted.

Physical Android installation/update, on-device offline behavior, cache inspection and TalkBack remain NOT RUN and still require external handset evidence.


## Superseding repository snapshot — 2026-11-26 16:04 UTC

The current PR #245 head was re-fetched as `ed2f8452c866495b5f1048e8a752e82f71f60a34`. PR #245 remains open, unmerged and Draft; GitHub reports mergeable=true at this snapshot. No merge or deployment was attempted.

The six relevant workflows attached to this exact candidate commit have now completed successfully:
- Run 45855063261 — S-TRADE Demo Screen Wiring Tests: SUCCESS (desktop/mobile/accessibility/performance/offline PWA smoke).
- Run 45855063150 — S-TRADE Authenticated Browser Security: SUCCESS (Chromium CSP/XSS).
- Run 45855063232 — Paper Trading Supabase SQL smoke test: SUCCESS (including the tenant-isolation catalog guard).
- Run 45855063259 — Validate Indian Market Code: SUCCESS (syntax and gateway unit tests).
- Run 45855063228 — Firebase read-only export tool tests: SUCCESS.
- Run 45855063095 — S-TRADE Futures Options Demo UI Integration: SUCCESS.

The earlier catalog failure observed on a prior merge snapshot (where `cancel_paper_protective_order` was flagged) is superseded for this exact head by the successful current-head SQL smoke run. The current migration/test code explicitly checks the approved protective-order RPC allowlist and the `auth.uid()` owner guard; no speculative permission patch was applied during this QA continuation.

The earlier snapshot sections above are historical evidence and must not be read as the latest state. This update supersedes their candidate-head/workflow status.

Physical Android install/update, actual handset offline/reconnect/cache behavior and TalkBack remain **NOT RUN**. Chromium emulation and CI do not close those physical-device gates. No device model, OS or browser version is claimed. Keep PR #245 Draft until real handset evidence and required review are complete.
