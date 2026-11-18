"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {authenticateFirebaseRequest} = require("../lib/firebase-auth");

function request(header) {
  return {get(name) { assert.equal(name, "authorization"); return header; }};
}

test("rejects missing and empty bearer credentials", async () => {
  for (const header of [undefined, "", "Basic abc", "Bearer "]) {
    await assert.rejects(authenticateFirebaseRequest(request(header), {
      verifyIdToken: async () => ({uid:"u1"})
    }), {status:401});
  }
});

test("verifies Firebase ID tokens with revocation checking enabled", async () => {
  let received;
  const result = await authenticateFirebaseRequest(request("Bearer signed-token"), {
    async verifyIdToken(token, checkRevoked) {
      received = {token, checkRevoked};
      return {uid:"u1"};
    }
  });
  assert.deepEqual(received, {token:"signed-token", checkRevoked:true});
  assert.deepEqual(result, {uid:"u1"});
});

test("rejects revoked, expired, disabled and deleted-user tokens", async () => {
  for (const code of [
    "auth/id-token-revoked",
    "auth/id-token-expired",
    "auth/user-disabled",
    "auth/user-not-found"
  ]) {
    await assert.rejects(authenticateFirebaseRequest(request("Bearer token"), {
      async verifyIdToken() { throw Object.assign(new Error("private detail"), {code}); }
    }), {status:401, message:"Sign in required"});
  }
});

test("fails closed with a service error when Firebase verification is unavailable", async () => {
  await assert.rejects(authenticateFirebaseRequest(request("Bearer token"), {
    async verifyIdToken() { throw Object.assign(new Error("internal detail"), {code:"auth/internal-error"}); }
  }), {status:503, message:"Authentication service unavailable"});
});
