"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {isVerifiedPasswordAccount} = require("../lib/upstox-email-verification");

test("requires email verification for password sign-in", () => {
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"password"},email_verified:false}}), false);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"password"}}}), false);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"password"},email_verified:true}}), true);
});

test("requires email verification for Google sign-in", () => {
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"google.com"},email_verified:false}}), false);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"google.com"}}}), false);
  assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:"google.com"},email_verified:true}}), true);
});

test("rejects anonymous, custom, phone and unknown providers", () => {
  for (const provider of ["anonymous", "custom", "phone", "facebook.com", ""]) {
    assert.equal(isVerifiedPasswordAccount({token:{firebase:{sign_in_provider:provider},email_verified:true}}), false);
  }
});

test("rejects missing authentication context or provider", () => {
  assert.equal(isVerifiedPasswordAccount(null), false);
  assert.equal(isVerifiedPasswordAccount({}), false);
  assert.equal(isVerifiedPasswordAccount({token:{email_verified:true}}), false);
});
