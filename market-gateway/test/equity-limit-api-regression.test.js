"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"..","supabase-server.js"),"utf8");
const orderRouteStart=source.indexOf('app.post("/paper/orders",');
const cancelRouteStart=source.indexOf('app.post("/paper/orders/:orderId/cancel",');
const protectiveRouteStart=source.indexOf('app.post("/paper/protective-orders",');
assert.ok(orderRouteStart>=0&&cancelRouteStart>orderRouteStart&&protectiveRouteStart>cancelRouteStart,
  "equity order and cancellation routes must remain present");

const orderRoute=source.slice(orderRouteStart,cancelRouteStart);
const cancelRoute=source.slice(cancelRouteStart,protectiveRouteStart);

test("Intraday LIMIT submission delegates verified identity to server RPC wrapper",()=>{
  assert.match(orderRoute,/product==="INTRADAY"\?"submit_paper_intraday_limit_order"/);
  assert.match(orderRoute,/runtime\.callUserRpc\(user,rpcName,rpcArgs\)/);
  assert.doesNotMatch(orderRoute,/p_user_id\s*:/);
});

test("LIMIT cancellation uses authenticated user-scoped client and server-injected identity",()=>{
  assert.match(cancelRoute,/const\s*\{\s*user\s*,\s*userDb\s*\}\s*=\s*await auth\(req\)/);
  assert.match(cancelRoute,/userDb\.from\("paper_orders"\)/);
  assert.match(cancelRoute,/cancel_paper_intraday_limit_order/);
  assert.match(cancelRoute,/cancel_paper_limit_order/);
  assert.doesNotMatch(cancelRoute,/p_user_id\s*:/);
});
