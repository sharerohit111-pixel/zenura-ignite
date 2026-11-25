# S-TRADE Chat 46 — Accessibility follow-up

## Scope

This follow-up adds a browser-time WCAG text contrast measurement to the existing 15-screen smoke test. It reuses the existing Demo route, navigation, fixtures, Playwright context and CI workflow. It does not add or duplicate screens.

## Automated contrast gate

For each of the 15 screens at the existing desktop (1440×900), Android-sized (390×844) and small-mobile (360×800) browser viewports, the smoke test now:

- visits the screen and enumerates visible leaf text nodes;
- reads computed foreground and nearest opaque computed background colors;
- composites transparent foreground/background colors against the discovered background;
- computes WCAG relative luminance and contrast ratio;
- applies 4.5:1 for normal text and 3:1 for large text (24px, or bold 18.66px);
- fails the browser smoke if a measured text node is below its threshold;
- emits per-screen measured-node counts and minimum observed ratio in CI JSON output.

This is a practical computed-color audit, not a complete visual contrast certification. It does not fully model gradients, background images, blend modes, text rendered inside canvas/SVG, disabled-control exceptions, or opacity applied to an ancestor. Chart graphics and non-text UI component contrast require separate review. Any reported failure must be triaged against a rendered screenshot before changing the palette.

## Existing automated coverage retained

- 15 existing screens, no duplicate route or screen;
- desktop, 390px and 360px viewports;
- per-screen axe WCAG 2.1 A/AA serious/critical violation gate;
- keyboard focus and Tab navigation;
- active navigation semantics and bilingual toggle/persistence checks;
- document horizontal-overflow checks;
- console/page error checks;
- PWA activation and offline fixture checks.

The axe gate currently filters for serious and critical impact. It does not claim zero violations at every impact level. The CI report must retain that distinction.

## Manual release gates — not completed by Chromium automation

- Physical Android handset: TalkBack navigation, announcements, rotor/reading order, focus order, touch target usability and language switching.
- Desktop assistive technology: NVDA with Firefox/Chrome or another documented supported combination; keyboard-only operation.
- Actual screen-reader review of dynamic status/error announcements, tables and interactive controls.
- Empty, loading, rejected-request and unavailable-fixture scenarios on each applicable screen.
- Screenshot-backed contrast review for gradients, charts, focus indicators, status badges and disabled controls.
- Private Watchlist signed-in restore/save after the documented auth bridge and gateway metadata are configured.

Record device, OS, browser, screen-reader version, test date, steps, outcome and evidence for each manual gate. Do not infer physical-device or assistive-technology PASS from Playwright viewport emulation.

## Safety

No production migration, auth configuration, broker integration, real order execution, Crypto changes, merge or deployment. The test change is isolated to the existing browser smoke script and this audit note.
