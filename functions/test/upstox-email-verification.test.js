"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {isVerifiedPasswordAccount} = require("../lib/upstox-email-verification");

test("requires email verification for password sign-in", () => {
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"password"},email_verified:false}}), false);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"password"},email_verified:true}}), true);
});

test("does not block Google and other federated providers", () => {
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"google.com"},email_verified:true}}), true);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"google.com"},email_verified:false}}), true);
});

test("rejects missing authentication context", () => {
  assert.equal(isVerifiedPasswordAccount(null), false);
  assert.equal(isVerifiedPasswordAccount({}), false);
});
