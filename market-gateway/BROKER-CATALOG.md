# S-TRADE broker catalogue

This module defines the initial broker choices for the connection/account-opening
surface. Dhan and Zerodha are deliberately excluded. The initial candidate list is
Upstox, FYERS and Angel One; Kotak Neo is not exposed until its required API pricing
and integration contract are verified.

## Referral configuration

Pass only owner-approved partner URLs to `getBrokerCatalog({ referralUrls })`.
The module validates HTTPS URLs and keeps the official account-opening URL separate.
When no referral URL is configured, the UI should display the official account-opening
link and must not imply that S-TRADE earns a commission.

Referral URLs are intentionally not hard-coded. Configure them after the owner supplies
the actual partner links. The UI should disclose a referral relationship when an
affiliate URL is active.

## Live data behavior

The catalogue is metadata, not an entitlement grant. It does not enable a live feed.
Each broker connection must remain user-scoped and use that user's own encrypted token.
The gateway must continue to fail closed when provider/instrument display entitlements
are absent. A broker's advertised zero-cost API plan is not a statement that every
third-party display or redistribution use is included.

## Test

Run the focused test with Node's built-in test runner:

```sh
node --test market-gateway/test/broker-catalog.test.js
```
