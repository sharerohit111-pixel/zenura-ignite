# Firebase Firestore Rules — migration security audit

## Scope

This is a static source audit for the existing Indian Paper Trading migration. It checks that the four Paper Trading/market-watchlist collections exported by the migration and the eight explicitly excluded sensitive collections retain explicit Firestore client read/write denial rules.

The test is intentionally offline. It does not connect to Firebase, inspect deployed rules, change rules, or prove that the deployed Firebase project is running the same source revision.

## Findings from the repository source

- \`indianPaperAccounts\`, \`indianPaperOrders\`, \`indianDerivativeOrders\`, and \`indianMarketWatchlists\` have explicit \`allow read, write: if false\` rules.
- Broker credentials/OAuth state, connection controls, stream leases, worker state, margin-preview limits, payment orders, and Razorpay events are excluded from the migration export and have explicit client read/write denial rules.
- \`customerProfiles\` and \`users\` are not globally server-only: source rules permit narrowly scoped owner access. They remain in the export allowlist only as profile/identity data, with UID-only Firebase Auth export and a separate identity mapping process.
- The existing \`market-gateway/test/firestore-rules-client.test.js\` uses the Firestore Emulator and is skipped when \`FIRESTORE_EMULATOR_HOST\` is absent. The migration workflow does not currently start the emulator, so its green CI result must not be interpreted as an executed emulator security test.

## Automated guard

The migration workflow runs \`test/firebase-firestore-rules-audit.test.js\` using Node's built-in test runner. It checks the source rules and exporter allowlist/exclusion list for drift. This is a static regression guard, not a replacement for the Firestore Emulator suite or a deployed-rules verification.

## Required before production migration

1. Run the full Firestore Emulator rules suite against the exact candidate rules file.
2. Verify the deployed rules revision and Firebase project in Firebase Console.
3. Confirm the Indian Paper Trading gateway runtime points to the same verified Firebase project.
4. Keep broker/OAuth/payment/worker collections excluded unless a separate data-classification and security review explicitly approves them.

No live Firebase rules were read or changed by this audit. No production export, Supabase import, deployment, or cutover was performed.
