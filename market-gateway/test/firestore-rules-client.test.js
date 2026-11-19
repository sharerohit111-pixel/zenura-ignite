"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");
const {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc
} = require("firebase/firestore");

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const integrationTest = emulatorAddress ? test : test.skip;
const [emulatorHost, emulatorPort] = (emulatorAddress || "127.0.0.1:8080").split(":");
const projectId = process.env.GCLOUD_PROJECT || "demo-zenura-ignite";
let environment;

test.before(async () => {
  if (!emulatorAddress) return;
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: emulatorHost,
      port: Number(emulatorPort),
      rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8")
    }
  });
});

test.after(async () => {
  if (environment) await environment.cleanup();
});

const serverOnlyDocuments = [
  ["indianPaperAccounts", "user-a"],
  ["indianPaperOrders", "order-a"],
  ["indianDerivativeOrders", "derivative-order-a"],
  ["upstoxConnections", "user-a"],
  ["upstoxOAuthStates", "oauth-state-a"],
  ["indianMarketWatchlists", "user-a"],
  ["indianMarketStreamLeases", "user-a"],
  ["indianMarginPreviewLimits", "user-a"],
  ["upstoxConnectionControls", "user-a"]
];

integrationTest("Firestore client rules deny access to every server-only Indian Market collection", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    for (const [collectionName, documentId] of serverOnlyDocuments) {
      await setDoc(doc(adminDb, collectionName, documentId), {
        uid: "user-a",
        sentinel: "server-seeded"
      });
    }
  });

  const userA = environment.authenticatedContext("user-a", {
    email: "user-a@example.com",
    email_verified: true
  }).firestore();
  const userB = environment.authenticatedContext("user-b", {
    email: "user-b@example.com",
    email_verified: true
  }).firestore();
  const anonymous = environment.unauthenticatedContext().firestore();

  for (const [collectionName, documentId] of serverOnlyDocuments) {
    const userADoc = doc(userA, collectionName, documentId);
    const userBDoc = doc(userB, collectionName, documentId);
    const anonymousDoc = doc(anonymous, collectionName, documentId);

    await assertFails(getDoc(userADoc), `owner read unexpectedly allowed: ${collectionName}`);
    await assertFails(getDoc(userBDoc), `cross-user read unexpectedly allowed: ${collectionName}`);
    await assertFails(getDoc(anonymousDoc), `anonymous read unexpectedly allowed: ${collectionName}`);
    await assertFails(getDocs(collection(userA, collectionName)));
    await assertFails(setDoc(userADoc, { uid: "user-a", injected: true }));
    await assertFails(updateDoc(userADoc, { sentinel: "client-modified" }));
    await assertFails(deleteDoc(userADoc));
  }
});

integrationTest("Firestore client rules deny creation of server-only Indian Market records", async () => {
  const userA = environment.authenticatedContext("user-a").firestore();
  const anonymous = environment.unauthenticatedContext().firestore();

  for (const [collectionName] of serverOnlyDocuments) {
    await assertFails(setDoc(doc(userA, collectionName, `new-${collectionName}`), {
      uid: "user-a",
      injected: true
    }));
    await assertFails(setDoc(doc(anonymous, collectionName, `anonymous-${collectionName}`), {
      uid: "anonymous",
      injected: true
    }));
  }
});

integrationTest("Firestore client rules preserve owner-only Premium entitlement reads", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "entitlements", "user-a"), {
      uid: "user-a",
      status: "premium",
      planId: "month_1",
      currentPeriodStart: new Date("2026-11-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
      autoRenew: false,
      provider: "upi_qr_manual",
      updatedAt: new Date("2026-11-01T00:00:00Z")
    });
  });

  const userA = environment.authenticatedContext("user-a").firestore();
  const userB = environment.authenticatedContext("user-b").firestore();
  await assertSucceeds(getDoc(doc(userA, "entitlements", "user-a")));
  await assertFails(getDoc(doc(userB, "entitlements", "user-a")));
});


integrationTest("Firestore client rules keep published catalogue public and hidden catalogue admin-only", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "publicCatalog", "published"), {
      published: true,
      categories: []
    });
    await setDoc(doc(db, "publicCatalog", "hidden"), {
      published: false,
      categories: []
    });
  });

  const anonymous = environment.unauthenticatedContext().firestore();
  const customer = environment.authenticatedContext("customer-a").firestore();
  const admin = environment.authenticatedContext("admin-a", {
    email: "sharerohit111@gmail.com",
    email_verified: true
  }).firestore();

  await assertSucceeds(getDoc(doc(anonymous, "publicCatalog", "published")));
  await assertFails(getDoc(doc(anonymous, "publicCatalog", "hidden")));
  await assertFails(getDoc(doc(customer, "publicCatalog", "hidden")));
  await assertSucceeds(getDoc(doc(admin, "publicCatalog", "hidden")));
});
