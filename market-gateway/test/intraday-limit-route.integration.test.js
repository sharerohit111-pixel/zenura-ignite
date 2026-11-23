"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const uid = "11111111-2222-4333-8444-555555555555";
const token = "route-integration-valid-token";
const rpcCalls = [];
const queryCalls = [];
const originalLoad = Module._load;

process.env.SUPABASE_URL = "https://project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_route_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-route-test";

Module._load = function(request, parent, isMain) {
  if (request === "@supabase/supabase-js") {
    return {
      createClient(_url, key) {
        return {
          auth: {
            async getUser(candidate) {
              return candidate === token
                ? { data: { user: { id: uid, email: "route@example.test" } }, error: null }
                : { data: { user: null }, error: { message: "invalid token" } };
            }
          },
          async rpc(name, args) {
            rpcCalls.push({ name, args, key });
            return { data: { status: "CANCELLED", cash_paise: 100000, reserved_cash_paise: 0 }, error: null };
          },
          from(table) {
            const filters = [];
            const query = {
              select(columns) { queryCalls.push({ table, columns }); return this; },
              eq(column, value) { filters.push([column, value]); return this; },
              async maybeSingle() {
                queryCalls.push({ table, filters });
                return {
                  data: { product: "INTRADAY", order_type: "LIMIT" },
                  error: null
                };
              }
            };
            return query;
          }
        };
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { app } = require("../supabase-server");
Module._load = originalLoad;

let server;
let baseUrl;
test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test("authenticated Intraday LIMIT cancellation resolves tenant order and calls the allowlisted RPC", async () => {
  rpcCalls.length = 0;
  queryCalls.length = 0;
  const orderId = "a".repeat(64);
  const response = await fetch(baseUrl + "/paper/orders/" + orderId + "/cancel", {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orderId, orderId);
  assert.equal(body.status, "CANCELLED");
  assert.equal(body.product, "INTRADAY");
  assert.equal(body.simulationOnly, true);
  assert.deepEqual(queryCalls.at(-1).filters, [
    ["user_id", uid],
    ["order_id", orderId]
  ]);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "cancel_paper_intraday_limit_order");
  assert.deepEqual(rpcCalls[0].args, { p_order_id: orderId, p_user_id: uid });
  assert.equal(rpcCalls[0].key, "server-only-route-test");
});

test("Intraday LIMIT submission fails closed while its execution worker is disabled", async () => {
  rpcCalls.length = 0;
  const response = await fetch(baseUrl + "/paper/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      instrument_key: "NSE_EQ|TEST",
      side: "BUY",
      order_type: "LIMIT",
      product: "INTRADAY",
      quantity: 1,
      limit_price_paise: 10000,
      idempotency_key: "22222222-2222-4222-8222-222222222222"
    })
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /worker is not enabled/i);
  assert.equal(rpcCalls.length, 0);
});

test("Intraday LIMIT cancellation rejects unauthenticated HTTP requests", async () => {
  rpcCalls.length = 0;
  const response = await fetch(baseUrl + "/paper/orders/" + "b".repeat(64) + "/cancel", {
    method: "POST"
  });
  assert.equal(response.status, 401);
  assert.equal(rpcCalls.length, 0);
});
