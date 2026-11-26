# Chat 68 — Physical Android, PWA and Accessibility QA Record

Date: 2026-11-26
Repository: sharerohit111-pixel/zenura-ignite
Candidate PR: #245 (must remain Draft)
Candidate HEAD: 98d7c300d33a7d9307ecc14fe93542ca500f08e6
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
