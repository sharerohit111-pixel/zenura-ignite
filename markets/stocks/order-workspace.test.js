"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const moduleSource=fs.readFileSync(path.join(__dirname,"order-workspace.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"order-workspace.css"),"utf8");
const gateway=fs.readFileSync(path.join(root,"market-gateway/server.js"),"utf8");

test("Paper Trading page loads isolated order workspace assets",()=>{
  assert.match(html,/<link rel="stylesheet" href="\.\/order-workspace\.css">/);
  assert.match(html,/<script src="\.\/order-workspace\.js"><\/script>/);
  assert.ok(fs.existsSync(path.join(__dirname,"order-workspace.js")));
  assert.ok(fs.existsSync(path.join(__dirname,"order-workspace.css")));
});

test("order ticket exposes MARKET and LIMIT choices without fake LIMIT submission",()=>{
  assert.match(html,/data-order-type="MARKET"/);
  assert.match(html,/data-order-type="LIMIT"/);
  assert.match(moduleSource,/LIMIT orders are not enabled by the current backend API/);
  assert.match(gateway,/Only MARKET orders are currently enabled; LIMIT orders are not active yet/);
  assert.doesNotMatch(moduleSource,/fetch\([^)]*\/paper\/orders[^)]*\{\s*method:\s*['"]POST['"]/s);
});

test("balances and histories use existing authenticated backend read contracts",()=>{
  assert.match(moduleSource,/\/paper\/account/);
  assert.match(moduleSource,/\/paper\/portfolio/);
  assert.match(moduleSource,/\/paper\/orders\?limit=100/);
  assert.match(gateway,/app\.get\(["']\/paper\/orders["']/);
  assert.match(gateway,/app\.get\(["']\/paper\/account["']/);
  assert.match(gateway,/app\.get\(["']\/paper\/portfolio["']/);
});

test("unsupported reserved balances and cancellation are never represented as zero or successful",()=>{
  assert.match(moduleSource,/Not exposed by backend/);
  assert.match(moduleSource,/CANCEL UNAVAILABLE/);
  assert.match(moduleSource,/backend has no verified cancel endpoint/);
  assert.doesNotMatch(moduleSource,/\/paper\/orders\/[^'"]+\/cancel/);
});

test("new order workspace includes responsive layouts and language switch",()=>{
  assert.match(html,/id="paper-language-toggle"/);
  assert.match(moduleSource,/language === 'en' \? 'हिन्दी' : 'English'/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:420px\)/);
});
