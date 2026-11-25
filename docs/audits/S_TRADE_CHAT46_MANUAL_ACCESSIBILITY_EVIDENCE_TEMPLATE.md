# S-TRADE Chat 46 — Manual UX / Accessibility Evidence Register

**Status:** OPEN — all entries below start as NOT RUN. This template is not test evidence and must not be treated as a PASS.

**Target PR head at template creation:** `338fcd19790e93262bb7ea87cf710776e075fe21`

## Execution record

For every execution, record the exact app commit, date/time, tester, device model, OS version, browser/version, assistive-technology/version, language, viewport, and evidence link. Repeat after any relevant UI or accessibility change.

| Gate | Status | Required evidence | Result / defect reference |
|---|---|---|---|
| Physical Android TalkBack | NOT RUN | Physical handset model + Android version; TalkBack version; screen recording/screenshots; focus and announcement notes | |
| Desktop screen reader + keyboard | NOT RUN | OS; NVDA (or supported AT) version; browser/version; keyboard-only steps; recording/log | |
| Visual contrast review | NOT RUN | Screenshots in both themes/languages as applicable; sampled foreground/background; ratio and WCAG threshold; gradients, imagery, charts, SVG/canvas, focus and status colors | |
| Dynamic status announcements | NOT RUN | Evidence for loading, success, rejected, unavailable and validation announcements; verify focus is not lost | |
| Authenticated Watchlist persistence | NOT RUN | Authenticated account fixture; add/reorder/remove; reload and re-login restore; account-switch isolation; gateway/auth configuration evidence | |

## Physical Android — per-screen execution

Run with TalkBack enabled on a real handset, not an emulated browser viewport. Check reading order, accessible name/role/state, focus visibility, touch-target usability, control operation, dynamic announcements, Hindi/English switching and return navigation.

| Screen | Status | Reading order / names / states | Touch / focus / language | Evidence |
|---|---|---|---|---|
| Home | NOT RUN | | | |
| Market | NOT RUN | | | |
| Watchlists | NOT RUN | | | |
| Charts / Depth | NOT RUN | | | |
| Equity | NOT RUN | | | |
| Futures | NOT RUN | | | |
| Options | NOT RUN | | | |
| Orders | NOT RUN | | | |
| Trades / Trade History | NOT RUN | | | |
| Portfolio | NOT RUN | | | |
| Positions | NOT RUN | | | |
| Holdings | NOT RUN | | | |
| Account / Wallet | NOT RUN | | | |
| Profile | NOT RUN | | | |
| Settings | NOT RUN | | | |

## Desktop screen reader + keyboard — per-screen execution

Use a documented supported screen-reader/browser combination. Test Tab / Shift+Tab, activation, visible focus, heading and landmark navigation, table semantics, form labels, error associations, and announcement of changing content.

| Screen | Status | Keyboard-only | Screen-reader semantics / announcements | Evidence |
|---|---|---|---|---|
| Home | NOT RUN | | | |
| Market | NOT RUN | | | |
| Watchlists | NOT RUN | | | |
| Charts / Depth | NOT RUN | | | |
| Equity | NOT RUN | | | |
| Futures | NOT RUN | | | |
| Options | NOT RUN | | | |
| Orders | NOT RUN | | | |
| Trades / Trade History | NOT RUN | | | |
| Portfolio | NOT RUN | | | |
| Positions | NOT RUN | | | |
| Holdings | NOT RUN | | | |
| Account / Wallet | NOT RUN | | | |
| Profile | NOT RUN | | | |
| Settings | NOT RUN | | | |

## State coverage — per applicable screen

Do not invent backend responses or use production accounts. Use deterministic local fixtures or approved test doubles, and capture the fixture/input and visible outcome. Mark N/A only with a reason.

| Screen | Empty state | Loading state | Rejected request | Unavailable / stale fixture | Evidence / N/A reason |
|---|---|---|---|---|---|
| Home | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Market | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Watchlists | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Charts / Depth | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Equity | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Futures | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Options | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Orders | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Trades / Trade History | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Portfolio | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Positions | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Holdings | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Account / Wallet | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Profile | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Settings | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |

## Closure rules

- Never change NOT RUN to PASS without linked, reproducible evidence.
- Record FAIL with a defect link and retest evidence; do not hide failures by marking N/A.
- Keep physical-device testing separate from Playwright viewport emulation.
- Keep authenticated Watchlist tests isolated by test account; do not use real financial accounts or real broker execution.
- This register does not authorize production migrations, live feeds, broker execution, deployment, merge, or changes to Crypto.
- The PR stays Draft until the manual gates are actually executed and reviewed.
