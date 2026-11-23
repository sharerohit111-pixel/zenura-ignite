"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const uid = "11111111-2222-4333-8444-555555555555";
const token = "route-integration-valid-token";
const rpcCalls = [];
const queryCalls = [];
let marketReplay = false;
const originalLoad = Module._load;

process.env.NODE_ENV = "test";
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
            return { data: name === "execute_paper_market_order"
              ? { order_id: args.p_order_id, status: "FILLED", gross_paise: 20010, charges_paise: 0,
                  cash_delta_paise: -20010, cash_paise: 9979990, order_realized_pnl_paise: 0,
                  idempotent_replay: marketReplay }
              : ["submit_paper_intraday_limit_order", "submit_paper_limit_order"].includes(name)
                ? { order_id: args.p_order_id, status: "PENDING", cash_paise: 10000000, reserved_cash_paise: 10000, idempotent_replay: false }
                : { status: "CANCELLED", cash_paise: 100000, reserved_cash_paise: 0 }, error: null };
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

const { app, configureRouteTestState } = require("../supabase-server");
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

test("authenticated Intraday LIMIT submission reaches the RPC with verified identity and official instrument metadata", async () => {
  rpcCalls.length = 0;
  configureRouteTestState({
    intradayLimitWorkerEnabled: true,
    instruments: [{
      instrument_key: "NSE_EQ|INE_TEST000001",
      instrument_type: "EQ",
      segment: "NSE_EQ",
      tick_size: "0.05",
      trading_symbol: "TESTCO",
      exchange: "NSE"
    }]
  });
  const idempotencyKey = "33333333-3333-4333-8333-333333333333";
  const response = await fetch(baseUrl + "/paper/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      instrument_key: "NSE_EQ|INE_TEST000001",
      side: "BUY",
      order_type: "LIMIT",
      product: "INTRADAY",
      quantity: 2,
      limit_price_paise: 10000,
      idempotency_key: idempotencyKey
    })
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, "PENDING");
  assert.equal(body.product, "INTRADAY");
  assert.equal(body.orderType, "LIMIT");
  assert.equal(body.quantity, 2);
  assert.equal(body.limitPricePaise, 10000);
  assert.equal(body.simulationOnly, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "submit_paper_intraday_limit_order");
  assert.equal(rpcCalls[0].key, "server-only-route-test");
  assert.equal(rpcCalls[0].args.p_user_id, uid);
  assert.equal(rpcCalls[0].args.p_idempotency_key, idempotencyKey);
  assert.equal(rpcCalls[0].args.p_instrument_key, "NSE_EQ|INE_TEST000001");
  assert.equal(rpcCalls[0].args.p_trading_symbol, "TESTCO");
  assert.equal(rpcCalls[0].args.p_exchange, "NSE");
  assert.equal(rpcCalls[0].args.p_limit_price_paise, 10000);
  assert.equal(rpcCalls[0].args.p_quantity, 2);
  configureRouteTestState({ intradayLimitWorkerEnabled: false });
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


test("authenticated DELIVERY LIMIT submission reaches its RPC with server-derived identity", async () => {
  rpcCalls.length = 0;
  configureRouteTestState({
    instruments: [{
      instrument_key: "NSE_EQ|INE_TEST000001",
      instrument_type: "EQ",
      segment: "NSE_EQ",
      tick_size: "0.05",
      trading_symbol: "TESTCO",
      exchange: "NSE"
    }]
  });
  const idempotencyKey = "44444444-4444-4444-8444-444444444444";
  const response = await fetch(baseUrl + "/paper/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      instrument_key: "NSE_EQ|INE_TEST000001",
      side: "SELL",
      order_type: "LIMIT",
      product: "DELIVERY",
      quantity: 2,
      limit_price_paise: 10000,
      idempotency_key: idempotencyKey
    })
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, "PENDING");
  assert.equal(body.product, "DELIVERY");
  assert.equal(body.side, "SELL");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "submit_paper_limit_order");
  assert.equal(rpcCalls[0].args.p_user_id, uid);
  assert.equal(rpcCalls[0].args.p_idempotency_key, idempotencyKey);
  assert.equal(rpcCalls[0].args.p_quantity, 2);
  assert.equal(rpcCalls[0].args.p_limit_price_paise, 10000);
});


function marketOrderBody(overrides={}) {
  return {
    instrument_key: "NSE_EQ|INE_TEST000001",
    side: "BUY",
    order_type: "MARKET",
    product: "DELIVERY",
    quantity: 2,
    idempotency_key: "55555555-5555-4555-8555-555555555555",
    ...overrides
  };
}
function configureMarketRoute({sessionOpen=true,quoteTime=Date.now(),lastPrice=100.05}={}) {
  const now=new Date();
  const sessionDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  configureRouteTestState({
    instruments:[{
      instrument_key:"NSE_EQ|INE_TEST000001",instrument_type:"EQ",segment:"NSE_EQ",
      tick_size:"0.05",trading_symbol:"TESTCO",exchange:"NSE"
    }],
    loadVerifiedExchangeSession:async(_db,exchange)=>({
      exchange,sessionDate,isTradingDay:true,openMinute:555,closeMinute:930
    }),
    isIntradaySessionOpen:()=>sessionOpen,
    getUpstoxAccessToken:async userId=>({token:"stub-market-token",connection:{user_id:userId}}),
    getQuote:async(tokenValue,instrumentKey)=>({
      quote:{instrument_token:instrumentKey,last_price:lastPrice,last_trade_time:quoteTime},
      payload:{}
    })
  });
}

test("authenticated MARKET route validates provider quote and calls atomic execution RPC", async () => {
  rpcCalls.length=0; marketReplay=false;
  configureMarketRoute();
  const response=await fetch(baseUrl+"/paper/orders",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(marketOrderBody())
  });
  const body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.status,"FILLED");
  assert.equal(body.executionPricePaise,10005);
  assert.equal(body.simulationOnly,true);
  assert.equal(rpcCalls.length,1);
  assert.equal(rpcCalls[0].name,"execute_paper_market_order");
  assert.equal(rpcCalls[0].args.p_user_id,uid);
  assert.equal(rpcCalls[0].args.p_execution_price_paise,10005);
  assert.equal(rpcCalls[0].args.p_instrument_key,"NSE_EQ|INE_TEST000001");
  assert.equal(rpcCalls[0].args.p_quote_timestamp_ms>0,true);
  configureRouteTestState({});
});

test("MARKET route fails closed when the verified exchange session is closed", async () => {
  rpcCalls.length=0; configureMarketRoute({sessionOpen:false});
  const response=await fetch(baseUrl+"/paper/orders",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(marketOrderBody({idempotency_key:"66666666-6666-4666-8666-666666666666"}))
  });
  assert.equal(response.status,409);
  assert.equal(rpcCalls.length,0);
  configureRouteTestState({});
});

test("MARKET route rejects a stale provider quote without calling execution RPC", async () => {
  rpcCalls.length=0; configureMarketRoute({quoteTime:Date.now()-30000});
  const response=await fetch(baseUrl+"/paper/orders",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(marketOrderBody({idempotency_key:"77777777-7777-4777-8777-777777777777"}))
  });
  assert.equal(response.status,409);
  assert.equal(rpcCalls.length,0);
  configureRouteTestState({});
});

test("MARKET route rejects a quote off the official instrument tick", async () => {
  rpcCalls.length=0; configureMarketRoute({lastPrice:100.03});
  const response=await fetch(baseUrl+"/paper/orders",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(marketOrderBody({idempotency_key:"88888888-8888-4888-8888-888888888888"}))
  });
  assert.equal(response.status,502);
  assert.equal(rpcCalls.length,0);
  configureRouteTestState({});
});

test("MARKET route returns HTTP 200 for a persisted idempotent replay result", async () => {
  rpcCalls.length=0; marketReplay=true; configureMarketRoute();
  const response=await fetch(baseUrl+"/paper/orders",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(marketOrderBody({idempotency_key:"99999999-9999-4999-8999-999999999999"}))
  });
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.idempotentReplay,true);
  assert.equal(rpcCalls.length,1);
  assert.equal(rpcCalls[0].name,"execute_paper_market_order");
  marketReplay=false; configureRouteTestState({});
});
