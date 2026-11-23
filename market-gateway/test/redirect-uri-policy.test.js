"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {validateHttpsRedirectUri} = require("../lib/redirect-uri-policy");

test("accepts canonical HTTPS callback and app redirect URLs", () => {
  assert.equal(
    validateHttpsRedirectUri("https://api.zenuraignite.com/upstox/oauth/callback"),
    "https://api.zenuraignite.com/upstox/oauth/callback"
  );
  assert.equal(
    validateHttpsRedirectUri("https://zenuraignite.com/markets/stocks/"),
    "https://zenuraignite.com/markets/stocks/"
  );
});

test("rejects non-HTTPS, credentials, query, fragment and malformed redirect URLs", () => {
  for (const value of [
    "http://api.zenuraignite.com/callback",
    "javascript:alert(1)",
    "https://user:pass@api.zenuraignite.com/callback",
    "https://api.zenuraignite.com/callback?next=https://evil.example",
    "https://api.zenuraignite.com/callback#fragment",
    " https://api.zenuraignite.com/callback",
    "https://api.zenuraignite.com./callback",
    "https://api.zenuraignite.com/callback\n",
    null,
    {}
  ]) assert.equal(validateHttpsRedirectUri(value), null, String(value));
});
