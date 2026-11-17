# ZENURA IGNITE — Crypto Paper Trading

This is an isolated app folder deployed alongside (not replacing) the ZENURA IGNITE website.

## Current scope
- Live public Binance Spot prices and candlestick history for BTC, ETH, BNB, SOL, XRP, ADA, DOGE and AVAX.
- Lightweight Charts candlestick chart with 1m, 5m, 15m, 1h, 4h and 1d intervals.
- INR-denominated simulated orders, 0.10% paper fee, balance checks, holdings, P&L and CSV history.
- ₹10,00,000 virtual starting balance stored locally in the current browser.
- Responsive PWA shell and service worker.

## Important limitations
- No real exchange orders, deposits, withdrawals, leverage or margin.
- USDT-to-INR is estimated using a USD/INR reference rate; it is not a direct exchange USDT/INR quote.
- Guest paper account data is local to one browser/device. Google sign-in and cloud sync are not enabled.
- GitHub Pages hosts the static PWA only. The optional Node.js market gateway must be hosted separately; do not run it on GitHub Pages.
- A live price feed is not guaranteed if the provider, ISP, browser or region blocks public market endpoints.

## Future platform architecture
- Google Sign-In: Firebase Authentication adapter; activate only after Firebase project configuration and backend security rules are in place.
- Premium: Razorpay order creation, signature verification and subscription webhooks must run server-side. Premium feature access must come from verified server entitlements.
- Google Ads: disabled until publisher ID, consent/privacy disclosures and compliant placements are configured.
- Never place secrets, service-account keys, Razorpay secret keys or admin credentials in frontend files.

## Deployment
The repository's existing GitHub Pages workflow publishes the repository root. This app lives at `/crypto/`, so it can be visited without replacing the root website.