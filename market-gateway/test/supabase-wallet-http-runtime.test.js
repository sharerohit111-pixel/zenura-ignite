"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");

const nativeFetch = global.fetch;
const USERS = {
  "token-user-a": {
    id: "11111111-1111-4111-8111-111111111111",
    email: "a@example.test"
  },
  "token-user-b": {
    id: "22222222-2222-4222-8222-222222222222",
    email: "b@example.test"
  }
};
const ACCOUNTS = {
  [USERS["token-user-a"].id]: {
    user_id: USERS["token-user-a"].id,
    cash_paise: 1000000,
    reserved_cash_paise: 100000,
    reserved_margin_paise: 200000,
    realized_pnl_paise: 0,
    intraday_realized_pnl_paise: 0,
    delivery_realized_pnl_paise: 0,
    version: 1
  },
  [USERS["token-user-b"].id]: {
    user_id: USERS["token-user-b"].id,
    cash_paise: 2000000,
    reserved_cash_paise: 400000,
    reserved_margin_paise: 100000,
    realized_pnl_paise: 0,
    intraday_realized_pnl_paise: 0,
    delivery_realized_pnl_paise: 0,
    version: 1
  }
};

let supabaseStub;
let gateway;
let supabaseOrigin;
let gatewayOrigin;
const observedQueries = [];

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function bearer(req) {
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization || "");
  return match ? match[1] : null;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

test("authenticated wallet and empty portfolio APIs return only the caller's account", async t => {
  supabaseStub = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/auth/v1/user") {
      const user = USERS[bearer(req)];
      return user ? sendJson(res, 200, user) : sendJson(res, 401, { message: "invalid token" });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const rpc = url.pathname.split("/").pop();
      const body = await readJson(req);
      if (rpc === "consume_paper_api_rate_limit") {
        return sendJson(res, 200, { allowed: true, remaining: 99, retry_after_seconds: 0 });
      }
      if (rpc === "initialize_paper_trading_account") {
        return sendJson(res, 200, { created: false, user_id: body.p_user_id });
      }
      return sendJson(res, 404, { message: "unexpected RPC" });
    }
    if (url.pathname === "/rest/v1/paper_accounts") {
      const userId = url.searchParams.get("user_id");
      observedQueries.push({ table: "paper_accounts", userId, token: bearer(req) });
      const account = ACCOUNTS[userId?.replace(/^eq\./, "")];
      return account
        ? sendJson(res, 200, account)
        : sendJson(res, 406, { message: "no account" });
    }
    if (/^\/rest\/v1\/paper_(positions|derivative_positions|futures_positions)$/.test(url.pathname)) {
      observedQueries.push({
        table: url.pathname.split("/").pop(),
        userId: url.searchParams.get("user_id"),
        token: bearer(req)
      });
      return sendJson(res, 200, []);
    }
    return sendJson(res, 404, { message: "unexpected Supabase route", path: url.pathname });
  });
  supabaseStub.listen(0, "127.0.0.1");
  await once(supabaseStub, "listening");
  const supabasePort = supabaseStub.address().port;
  supabaseOrigin = `https://127.0.0.1:${supabasePort}`;

  // Route the Supabase SDK's HTTPS requests to this isolated local HTTP stub.
  global.fetch = (input, init) => {
    const rawUrl = typeof input === "string" ? input : input.url;
    if (rawUrl.startsWith(supabaseOrigin)) {
      const localUrl = rawUrl.replace(supabaseOrigin, `http://127.0.0.1:${supabasePort}`);
      const localInput = input instanceof Request ? new Request(localUrl, input) : localUrl;
      return nativeFetch(localInput, init);
    }
    return nativeFetch(input, init);
  };
  process.env.SUPABASE_URL = supabaseOrigin;
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.UPSTOX_TOKEN_ENCRYPTION_KEY = "test-only-unused-key";
  process.env.UPSTOX_CLIENT_ID = "test-only-unused-client";
  process.env.UPSTOX_CLIENT_SECRET = "test-only-unused-secret";
  process.env.UPSTOX_REDIRECT_URI = "https://example.test/upstox/oauth/callback";
  process.env.ZENURA_APP_REDIRECT_URI = "https://example.test/markets/stocks/";
  process.env.ALLOWED_ORIGINS = "https://example.test";

  const { app } = require("../supabase-server");
  gateway = http.createServer(app);
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  gatewayOrigin = `http://127.0.0.1:${gateway.address().port}`;

  t.after(async () => {
    global.fetch = nativeFetch;
    await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => supabaseStub.close(resolve));
  });

  async function get(path, token) {
    const response = await nativeFetch(gatewayOrigin + path, {
      headers: { authorization: `Bearer ${token}` }
    });
    return { status: response.status, body: await response.json() };
  }

  const aAccount = await get("/paper/account", "token-user-a");
  const bAccount = await get("/paper/account?user_id=" + USERS["token-user-a"].id, "token-user-b");
  assert.equal(aAccount.status, 200);
  assert.equal(bAccount.status, 200);
  assert.deepEqual(
    [aAccount.body.cashPaise, aAccount.body.availableCashPaise, aAccount.body.blockedCashPaise],
    [1000000, 700000, 300000]
  );
  assert.deepEqual(
    [bAccount.body.cashPaise, bAccount.body.availableCashPaise, bAccount.body.blockedCashPaise],
    [2000000, 1500000, 500000]
  );

  for (const [token, expected] of [
    ["token-user-a", [1000000, 700000, 300000]],
    ["token-user-b", [2000000, 1500000, 500000]]
  ]) {
    for (const path of [
      "/paper/portfolio",
      "/paper/derivatives/portfolio",
      "/paper/futures/portfolio"
    ]) {
      const result = await get(path, token);
      assert.equal(result.status, 200, `${path} should return HTTP 200`);
      assert.deepEqual(
        [result.body.cashPaise, result.body.availableCashPaise, result.body.blockedCashPaise],
        expected,
        `${path} must return the authenticated user's wallet values`
      );
      assert.equal(result.body.positions.length, 0);
    }
  }

  for (const query of observedQueries) {
    const expectedUser = USERS[query.token]?.id;
    assert.equal(query.userId, `eq.${expectedUser}`, `${query.table} query must be owner-filtered`);
  }
  assert.ok(observedQueries.some(query => query.token === "token-user-a"));
  assert.ok(observedQueries.some(query => query.token === "token-user-b"));
});
