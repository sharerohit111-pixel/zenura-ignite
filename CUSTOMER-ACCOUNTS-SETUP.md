# Customer Accounts — Firebase Release Checklist

This checklist is for the existing ZENURA IGNITE Firebase project. It does not create a new Firebase project.

## Existing project

- Firebase project ID: `zenura-ignite-technologies`
- Authentication admin account: `sharerohit111@gmail.com`
- GitHub Pages origin: `https://sharerohit111-pixel.github.io`
- Customer account page: `/zenura-ignite/customer.html`

## 1. Enable sign-in providers

In Firebase Console, open **Authentication → Sign-in method**:

1. Enable **Email/Password** (the email/password provider).
2. Enable **Google** and select the existing project support email.
3. Save each provider.

Then open **Authentication → Settings → Authorized domains** and ensure
`sharerohit111-pixel.github.io` is listed. Keep existing authorized domains; do not remove any domain already in use.

## 2. Deploy only the Firestore rules

The repository's `firebase.json` already maps Firestore rules to `firestore.rules`.
From a trusted terminal with Firebase CLI installed and an authorized Firebase account:

```sh
firebase login
firebase use --add
# Select the existing project: zenura-ignite-technologies
firebase deploy --only firestore:rules
```

Do not deploy Functions or Storage as part of this customer-account change. Review the project selected by `firebase use` before deploying.

## 3. Required acceptance tests

Use two separate customer email accounts (A and B), plus the verified admin account.

- Customer A can create an account, receive verification email, verify, sign in, edit their own name/phone, and sign out.
- An unverified customer cannot reach the dashboard.
- Customer B cannot read or change Customer A's `customerProfiles/{uid}`, `payments`, or `entitlements/{uid}` records.
- Customer A can read only payment documents whose `uid` is A's authenticated UID.
- Customer accounts cannot create or update entitlements, approve payments, or grant themselves admin access.
- The verified admin account can still access `admin.html`; a non-admin account cannot.
- Google sign-in works for a normal customer account.

If any test fails, stop the release and fix the rules or client flow before merging.

## Release boundary

This PR adds customer account UI and profile access rules, but the existing public enquiry form is not yet linked to customer accounts. The dashboard must not be described as showing a customer's enquiry history until that integration is implemented.

Provider activation and Firestore rule deployment are Firebase Console/project operations. They are not performed by GitHub Pages and must be completed by an authorized Firebase project owner.
