"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gateway = fs.readFileSync(path.join(__dirname, "../supabase-server.js"), "utf8");
const fyersSetup = fs.readFileSync(path.join(__dirname, "../FYERS-OAUTH-SETUP.md"), "utf8");
const angelSetup = fs.readFileSync(path.join(__dirname, "../ANGEL-ONE-SMARTAPI-SETUP.md"), "utf8");
const deploymentGuide = fs.readFileSync(path.join(__dirname, "../BROKER-CONNECTION-DEPLOYMENT-SETUP.md"), "utf8");
const deploymentWorkflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/deploy-supabase-market-gateway.yml"), "utf8");

test("FYERS runtime configuration is wired server-side and documented consistently", () => {
  for (const name of ["FYERS_CLIENT_ID", "FYERS_CLIENT_SECRET", "FYERS_REDIRECT_URI", "BROKER_TOKEN_ENCRYPTION_KEY"]) {
    assert.match(gateway, new RegExp(name));
    assert.ok(fyersSetup.includes(name), `FYERS setup guide must document ${name}`);
    assert.ok(deploymentGuide.includes(name), `deployment guide must document ${name}`);
  }
  assert.match(gateway, /app\.use\("\/fyers",createFyersOAuthRouter/);
});

test("Angel One runtime configuration is wired server-side and documented consistently", () => {
  for (const name of [
    "ANGEL_ONE_SMARTAPI_KEY", "ANGEL_ONE_CLIENT_LOCAL_IP", "ANGEL_ONE_CLIENT_PUBLIC_IP",
    "ANGEL_ONE_MAC_ADDRESS", "ANGEL_ONE_SOURCE_ID", "BROKER_TOKEN_ENCRYPTION_KEY"
  ]) {
    assert.match(gateway, new RegExp(name));
    assert.ok(angelSetup.includes(name), `Angel One setup guide must document ${name}`);
    assert.ok(deploymentGuide.includes(name), `deployment guide must document ${name}`);
  }
  assert.match(gateway, /app\.use\("\/angel-one",createAngelOneRouter/);
});

test("Cloud Run deployment remains manually gated to main and does not silently enable unconfigured brokers", () => {
  assert.match(deploymentWorkflow, /workflow_dispatch:/);
  assert.match(deploymentWorkflow, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.doesNotMatch(deploymentWorkflow, /FYERS_CLIENT_ID|FYERS_CLIENT_SECRET|ANGEL_ONE_SMARTAPI_KEY/);
  assert.match(deploymentGuide, /A separate reviewed change is required before FYERS or Angel One can be enabled/);
});

test("broker setup guides keep credentials out of frontend configuration", () => {
  assert.match(fyersSetup, /never expose it to the browser/i);
  assert.match(angelSetup, /never expose it in the static frontend/i);
  assert.match(deploymentGuide, /Do not add provider credentials to Git, GitHub Pages, frontend environment files/i);
});
