"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPORT_COLLECTIONS,
  EXCLUDED_COLLECTIONS
} = require("../scripts/firebase-readonly-export");

const rules = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");

function hasExplicitDeny(collectionName) {
  const escaped = collectionName.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    "match\\s+/" + escaped + "/\\{[^}]+\\}\\s*\\{\\s*allow\\s+read,\\s*write:\\s*if\\s+false;\\s*\\}"
  );
  return pattern.test(rules);
}

test("exported Paper Trading and market-watchlist collections remain server-only", () => {
  const expected = [
    "indianPaperAccounts",
    "indianPaperOrders",
    "indianDerivativeOrders",
    "indianMarketWatchlists"
  ];
  for (const collectionName of expected) {
    assert.ok(EXPORT_COLLECTIONS.includes(collectionName), "export allowlist missing " + collectionName);
    assert.ok(hasExplicitDeny(collectionName), "Firestore rules must explicitly deny client read/write for " + collectionName);
  }
});

test("sensitive broker, worker, margin and payment collections remain excluded and server-only", () => {
  const expected = [
    "upstoxConnections",
    "upstoxOAuthStates",
    "upstoxConnectionControls",
    "indianMarketStreamLeases",
    "indianMarketWorkerState",
    "indianMarginPreviewLimits",
    "paymentOrders",
    "razorpayEvents"
  ];
  const excludedNames = EXCLUDED_COLLECTIONS.map(value => value.split(" ")[0]);
  for (const collectionName of expected) {
    assert.ok(excludedNames.includes(collectionName), "sensitive collection must remain excluded from export: " + collectionName);
    assert.ok(hasExplicitDeny(collectionName), "Firestore rules must explicitly deny client read/write for " + collectionName);
  }
});

test("migration allowlist does not accidentally include broker credentials or payment internals", () => {
  const forbidden = [
    "upstoxConnections",
    "upstoxOAuthStates",
    "upstoxConnectionControls",
    "paymentOrders",
    "razorpayEvents",
    "indianMarketStreamLeases",
    "indianMarketWorkerState",
    "indianMarginPreviewLimits"
  ];
  for (const collectionName of forbidden) {
    assert.equal(EXPORT_COLLECTIONS.includes(collectionName), false, collectionName + " must not be added to the migration export allowlist");
  }
});
