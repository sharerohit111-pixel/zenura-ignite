"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_instrument_search_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-instrument-search-test";

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient() {
    return {
      auth: { async getUser() { return { data: { user: null }, error: { message: "not used by public instrument route" } }; } },
      async rpc() { return { data: null, error: null }; },
      from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }; }
    };
  } };
  return originalLoad.call(this, request, parent, isMain);
};
const { app, configureRouteTestState } = require("../supabase-server");
Module._load = originalLoad;

const instruments = [
  { instrument_key: "NSE_EQ|XTCS", segment: "NSE_EQ", exchange: "NSE", instrument_type: "EQ", trading_symbol: "XTCS", name: "Example Holdings Ltd", tick_size: "0.05" },
  { instrument_key: "NSE_EQ|TCSIND", segment: "NSE_EQ", exchange: "NSE", instrument_type: "EQ", trading_symbol: "TCSIND", name: "TCS Industries Ltd", tick_size: "0.05" },
  { instrument_key: "NSE_EQ|TCS", segment: "NSE_EQ", exchange: "NSE", instrument_type: "EQ", trading_symbol: "TCS", name: "Tata Consultancy Services", tick_size: "0.05" },
  { instrument_key: "BSE_EQ|TCS", segment: "BSE_EQ", exchange: "BSE", instrument_type: "EQ", trading_symbol: "TCS", name: "Tata Consultancy Services", tick_size: "0.05" },
  { instrument_key: "NSE_FO|TCS", segment: "NSE_FO", exchange: "NSE", instrument_type: "FUT", trading_symbol: "TCS-FUT", name: "TCS Future", tick_size: "0.05" }
];

let server, baseUrl;
test.before(async () => {
  configureRouteTestState({ instruments });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  baseUrl = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test("GET /instruments ranks exact equity symbols before prefixes and substring matches", async () => {
  const response = await fetch(baseUrl + "/instruments?kind=equities&exchange=NSE&q=tcs&limit=10");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map(x => x.instrument_key), ["NSE_EQ|TCS", "NSE_EQ|TCSIND", "NSE_EQ|XTCS"]);
  assert.equal(body.count, 3);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
});

test("GET /instruments includes NSE and BSE equities when exchange is not specified", async () => {
  const response = await fetch(baseUrl + "/instruments?kind=equities&q=tcs");
  const body = await response.json();
  assert.equal(response.status, 200);
  // Exact symbol matches tie; the documented lexical symbol/key tie-breaker puts BSE_EQ|TCS first.
  assert.deepEqual(body.results.map(x => x.instrument_key), ["BSE_EQ|TCS", "NSE_EQ|TCS", "NSE_EQ|TCSIND", "NSE_EQ|XTCS"]);
});

test("GET /instruments retains exchange and instrument-kind filters before ranking", async () => {
  const response = await fetch(baseUrl + "/instruments?kind=equities&exchange=BSE&q=tcs");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map(x => x.instrument_key), ["BSE_EQ|TCS"]);
});

test("GET /instruments preserves instrument-master order when no search query is supplied", async () => {
  const response = await fetch(baseUrl + "/instruments?kind=all&limit=2");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map(x => x.instrument_key), ["NSE_EQ|XTCS", "NSE_EQ|TCSIND"]);
});
