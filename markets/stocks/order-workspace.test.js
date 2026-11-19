"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {execFileSync}=require("node:child_process");

const root=path.resolve(__dirname,"../..");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const source=fs.readFileSync(path.join(__dirname,"order-workspace.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"order-workspace.css"),"utf8");
const gateway=fs.readFileSync(path.join(root,"market-gateway/server.js"),"utf8");
const accountState=fs.readFileSync(path.join(root,"market-gateway/lib/paper-account-state.js"),"utf8");
const limitTransaction=fs.readFileSync(path.join(root,"market-gateway/lib/pending-limit-order-transaction.js"),"utf8");
const worker=fs.readFileSync(path.join(root,"functions/indian-market.js"),"utf8");

test("Paper Trading page loads isolated order workspace assets",()=>{
  assert.match(html,/<link rel="stylesheet" href="\.\/order-workspace\.css">/);
  assert.match(html,/<script src="\.\/order-workspace\.js"><\/script>/);
  assert.match(html,/id="paper-order-ticket"/);
  assert.ok(fs.existsSync(path.join(__dirname,"order-workspace.js")));
  assert.ok(fs.existsSync(path.join(__dirname,"order-workspace.css")));
});

test("MARKET remains on the existing market-order flow and LIMIT uses the verified API",()=>{
  assert.match(html,/data-order-type="MARKET"/);
  assert.match(html,/data-order-type="LIMIT"/);
  assert.match(source,/order_type:'LIMIT'/);
  assert.match(source,/limit_price_paise:limitPricePaise/);
  assert.match(source,/idempotency_key:pending\.key/);
  assert.match(gateway,/orderType==="LIMIT"/);
  assert.match(gateway,/placePendingLimitOrder/);
  assert.match(gateway,/Only MARKET and LIMIT paper orders are supported/);
});

test("Pending LIMIT cancellation calls the authenticated backend endpoint",()=>{
  assert.match(source,/\/paper\/orders\/' \+ encodeURIComponent\(orderId\) \+ '\/cancel/);
  assert.match(source,/data\.status !== 'CANCELLED'/);
  assert.match(source,/data\.reservationReleased !== true/);
  assert.match(gateway,/app\.post\(["']\/paper\/orders\/:orderId\/cancel["']/);
  assert.match(limitTransaction,/cancelPendingLimitOrder/);
});

test("Available and reserved cash and shares use account reservation fields",()=>{
  assert.match(source,/account\.reservedCashPaise/);
  assert.match(source,/account\.reservedMarginPaise/);
  assert.match(source,/account\.reservedPositions/);
  assert.match(source,/account\.positions/);
  assert.match(accountState,/reservedCashPaise/);
  assert.match(accountState,/reservedPositions/);
});

test("Order and trade history use backend statuses, execution prices and cursor pagination",()=>{
  assert.match(source,/\/paper\/orders\?/);
  assert.match(source,/params\.set\('cursor', nextCursor\)/);
  assert.match(source,/order\.executionPricePaise/);
  assert.match(source,/order\.createdAt/);
  assert.match(source,/order\.status === 'PENDING'/);
  assert.match(source,/status\)\.toUpperCase\(\) === 'FILLED'/);
  assert.match(source,/status\)\.toUpperCase\(\) === 'CANCELLED'/);
  assert.match(gateway,/nextCursor:hasMore/);
});

test("Backend scheduled worker checks pending LIMIT orders every minute",()=>{
  assert.match(worker,/processPendingPaperLimitOrders/);
  assert.match(worker,/schedule:"every 1 minutes"/);
  assert.match(worker,/processPendingLimitOrders/);
});

test("responsive and bilingual UI states are present",()=>{
  assert.match(html,/id="paper-language-toggle"/);
  assert.match(source,/language === 'en' \? 'हिन्दी' : 'English'/);
  assert.match(source,/dataset\.state = kind/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/paper-cancel-button/);
});

test("order workspace JavaScript parses in the configured Node runtime",()=>{
  assert.doesNotThrow(()=>execFileSync(process.execPath,["--check",path.join(__dirname,"order-workspace.js")],{stdio:"pipe"}));
});
