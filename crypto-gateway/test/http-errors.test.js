"use strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server");

test("returns safe JSON errors for malformed and oversized request bodies", async () => {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const malformed = await fetch(base + "/crypto/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid-json"
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get("content-type") || "", /application\/json/);
    assert.equal(malformed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await malformed.json(), { error: "Request body must contain valid JSON." });

    const oversized = await fetch(base + "/crypto/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17000) })
    });
    assert.equal(oversized.status, 413);
    assert.match(oversized.headers.get("content-type") || "", /application\/json/);
    assert.deepEqual(await oversized.json(), { error: "Request body is too large." });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
