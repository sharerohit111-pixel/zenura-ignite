"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPECTED_FIREBASE_PROJECT_ID,
  backfillSupabaseRoleClaims
} = require("../lib/supabase-role-claim-backfill");

function fakeAuth(pages) {
  const calls = [];
  return {
    calls,
    async listUsers(pageSize, pageToken) {
      calls.push(["listUsers", pageSize, pageToken]);
      const key = pageToken || "first";
      if (!Object.prototype.hasOwnProperty.call(pages, key)) {
        throw new Error("Unexpected page token");
      }
      return pages[key];
    },
    async setCustomUserClaims(uid, claims) {
      calls.push(["setCustomUserClaims", uid, claims]);
    }
  };
}

test("dry-run is paginated and never writes claims", async () => {
  const auth = fakeAuth({
    first: {
      users: [
        { uid: "uid-a", customClaims: { theme: "dark" } },
        { uid: "uid-b", customClaims: { role: "authenticated", plan: "free" } }
      ],
      pageToken: "next"
    },
    next: {
      users: [
        { uid: "uid-c", customClaims: { role: "admin" } },
        { uid: "uid-d", customClaims: null }
      ]
    }
  });

  const result = await backfillSupabaseRoleClaims({
    auth,
    projectId: EXPECTED_FIREBASE_PROJECT_ID,
    pageSize: 2
  });

  assert.deepEqual(result, {
    projectId: EXPECTED_FIREBASE_PROJECT_ID,
    scanned: 4,
    alreadyConfigured: 1,
    planned: 2,
    updated: 0,
    roleConflicts: 1
  });
  assert.equal(auth.calls.filter(call => call[0] === "setCustomUserClaims").length, 0);
});

test("apply preserves unrelated claims and skips conflicting roles", async () => {
  const auth = fakeAuth({
    first: {
      users: [
        { uid: "uid-a", customClaims: { theme: "dark", beta: true } },
        { uid: "uid-b", customClaims: { role: "authenticated", plan: "free" } },
        { uid: "uid-c", customClaims: { role: "admin" } }
      ]
    }
  });

  const result = await backfillSupabaseRoleClaims({
    auth,
    projectId: EXPECTED_FIREBASE_PROJECT_ID,
    apply: true,
    thirdPartyAuthReady: true
  });

  assert.deepEqual(result, {
    projectId: EXPECTED_FIREBASE_PROJECT_ID,
    scanned: 3,
    alreadyConfigured: 1,
    planned: 0,
    updated: 1,
    roleConflicts: 1
  });
  assert.deepEqual(auth.calls.filter(call => call[0] === "setCustomUserClaims"), [
    ["setCustomUserClaims", "uid-a", { theme: "dark", beta: true, role: "authenticated" }]
  ]);
});

test("apply is blocked until the Supabase Firebase integration is confirmed ready", async () => {
  const auth = fakeAuth({ first: { users: [] } });
  await assert.rejects(
    backfillSupabaseRoleClaims({
      auth,
      projectId: EXPECTED_FIREBASE_PROJECT_ID,
      apply: true,
      thirdPartyAuthReady: false
    }),
    error => error.code === "SUPABASE_THIRD_PARTY_AUTH_NOT_READY"
  );
  assert.equal(auth.calls.length, 0);
});

test("refuses to run against a different Firebase project", async () => {
  const auth = fakeAuth({ first: { users: [] } });
  await assert.rejects(
    backfillSupabaseRoleClaims({ auth, projectId: "wrong-project" }),
    error => error.code === "FIREBASE_PROJECT_MISMATCH"
  );
  assert.equal(auth.calls.length, 0);
});

test("rejects malformed custom claims instead of overwriting them", async () => {
  const auth = fakeAuth({ first: { users: [{ uid: "uid-a", customClaims: ["bad"] }] } });
  await assert.rejects(
    backfillSupabaseRoleClaims({ auth, projectId: EXPECTED_FIREBASE_PROJECT_ID }),
    error => error.code === "FIREBASE_CUSTOM_CLAIMS_INVALID"
  );
});
