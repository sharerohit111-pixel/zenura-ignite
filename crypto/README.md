# ZENURA IGNITE — Crypto Paper Trading

This is an isolated app folder deployed alongside (not replacing) the ZENURA IGNITE website.

## Current interface and simulator
- Separate Watchlist, Trading Terminal and Profit & Loss pages; selecting a watchlist asset opens its chart and order ticket.
- Live public Binance Spot prices and candlestick history for BTC, ETH, BNB, SOL, XRP, ADA, DOGE and AVAX.
- Lightweight Charts candlestick chart with 1m, 5m, 15m, 1h, 4h and 1d intervals, plus chart fullscreen.
- INR-denominated simulated Market Buy/Sell orders, 0.10% paper fee, balance checks, holdings, CSV history.
- Optional stop-loss and take-profit prices attached to an open long position. A trigger is simulated from the live ticker stream while the page is open and connected; it is not an exchange-side order and will not run reliably in the background or while the device is offline.
- Profit/loss summary with green positive and red negative unrealized P&L treatment.
- Side drawer with page navigation and a persisted Night appearance toggle.
- ₹10,00,000 virtual starting balance stored locally in the current browser.
- Responsive PWA shell and versioned service worker; HTML navigation uses network-first caching to pick up app updates.

## Important limitations
- Paper trading only: no real exchange orders, deposits, withdrawals, leverage or margin.
- USDT-to-INR is estimated using a USD/INR reference rate; it is not a direct exchange USDT/INR quote.
- Guest paper account data is local to one browser/device. Clearing browser storage or changing device/browser does not sync or restore this account.
- Google and email sign-in controls are present as a planned integration surface but remain disabled until Firebase Authentication is configured with the correct project credentials and authorized domains. There is no real sign-in/sign-out session yet.
- Stop-loss and target monitoring is client-side only. A production-grade always-on risk engine needs a backend market feed and server-side execution scheduler.
- GitHub Pages hosts the static PWA only. The optional Node.js market gateway must be hosted separately; do not run it on GitHub Pages.
- A live price feed is not guaranteed if the provider, ISP, browser or region blocks public market endpoints.

## Future platform architecture
- Google Sign-In: Firebase Authentication; add account-scoped cloud storage and security rules before enabling multi-user access.
- Premium: Razorpay order creation, signature verification and subscription webhooks must run server-side. Premium feature access must come from verified server entitlements.
- Google Ads: disabled until publisher ID, consent/privacy disclosures and compliant placements are configured.
- Never place secrets, service-account keys, Razorpay secret keys or admin credentials in frontend files.

## Deployment
The repository's existing GitHub Pages workflow publishes the repository root. This app lives at `/crypto/`, so it can be visited without replacing the root website.
