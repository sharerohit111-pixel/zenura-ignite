# ZENURA IGNITE Premium — implementation notes

## Commercial rules
- New authenticated account receives one server-created 3-day trial.
- Trial grants paper-order execution during the trial period.
- After trial expiry, order execution is denied until a verified Premium entitlement is active.
- One-time payments only; no automatic renewal or recurring mandate.
- Plans: 1 month ₹99, 3 months ₹199, 6 months ₹399, 1 year ₹799.
- Existing open positions, portfolio records and trade history are not deleted when access expires. Only new order execution is gated.
- A new paid period starts immediately, or extends from the current future Premium expiry.

## Backend
Firebase Cloud Functions v2 provides:
- `getPremiumEntitlement`: initializes the trial once on the server and returns current access.
- `createPremiumOrder`: creates a Razorpay INR order on the server.
- `verifyPremiumPayment`: validates the checkout signature and independently fetches the captured payment from Razorpay before activation.
- `razorpayWebhook`: validates the webhook HMAC and idempotently activates captured payments.

Firestore entitlement and order documents are server-write-only. Client users can read only their own entitlement and order records.

## Required setup before activation
1. Create or select a dedicated Firebase project for ZENURA IGNITE.
2. Enable Firebase Authentication providers: Google and Email/Password.
3. Configure the app's Firebase Web SDK values in a public client config file. These are project identifiers, not service-account credentials.
4. Deploy the Firestore rules from this folder.
5. Install dependencies from `crypto/functions` and deploy Firebase Functions.
6. Set Firebase Functions secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
7. Complete Razorpay merchant KYC and add the settlement bank account in Razorpay Dashboard. Configure the webhook URL for the deployed `razorpayWebhook` function and subscribe to `payment.captured`.
8. Test with Razorpay test mode before switching to live keys.

## Security requirements
- Never place Razorpay secret keys, webhook secrets, Firebase service-account JSON, or admin credentials in GitHub Pages files.
- Never unlock Premium from a browser-only flag or a payment success screen. The server verifies the signature and captured payment.
- The 3-day trial is account-based and server-timed, not a resettable localStorage timer.
- GitHub Pages is static hosting; Firebase Functions is the separate trusted backend.

## Deployment status
This folder is a backend implementation scaffold. It is not live until a Firebase project is configured, secrets are added, functions/rules are deployed, and the app's sign-in and checkout UI is connected to these callable functions. No live payment is collected by this commit.
