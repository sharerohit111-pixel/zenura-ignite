"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {apiRateLimitBucket}=require("../lib/api-rate-limit");

test("S-TRADE notification and admin reads/writes use existing authenticated account buckets",()=>{
 for(const path of ["/notifications","/preferences","/price-alerts","/admin/overview","/admin/users","/admin/providers","/admin/audit"])
  assert.equal(apiRateLimitBucket("GET",path),"account_read",path);
 for(const path of ["/notifications/abc/read","/preferences","/price-alerts","/admin/users/abc/status","/admin/controls/new_orders_enabled"])
  assert.equal(apiRateLimitBucket("POST",path),"account_write",path);
});

test("order pause control authenticates before reading operational state",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const source=fs.readFileSync(path.join(__dirname,"../supabase-server.js"),"utf8");
 const block=source.slice(source.indexOf("const ORDER_SUBMISSION_PATHS"),source.indexOf("function localNowMs"));
 assert.ok(block.indexOf("await auth(req)")>=0);
 assert.ok(block.indexOf("await auth(req)")<block.indexOf('from("s_trade_operational_controls")'));
 assert.match(block,/ORDER_SUBMISSION_PATHS/);
 assert.match(block,/paper\\/protective-orders/);
 assert.match(block,/replace\\(\/\\\\\\+\$\/,""\)\.toLowerCase\(\)/);
});
