"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=__dirname;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const js=fs.readFileSync(path.join(root,"investing.js"),"utf8");
const css=fs.readFileSync(path.join(root,"investing.css"),"utf8");
const gateway=fs.readFileSync(path.join(root,"../../market-gateway/supabase-server.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"../../supabase/migrations/202611220010_paper_investing_market_order.sql"),"utf8");
test("Paper Investing page includes all locally referenced modules and styles",()=>{
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  const ref=match[1];if(/^https?:|^#|^mailto:/.test(ref))continue;
  assert.ok(fs.existsSync(path.resolve(root,ref)), "Missing Paper Investing asset: "+ref);
 }
});
test("Paper Investing keeps an independent account, portfolio, order history and two-mode navigation",()=>{
 for(const id of ["investing-cash","investing-positions","investing-orders","investing-buy","investing-sell","investing-search","market-chart","chart-add-indicator","chart-undo","chart-redo","paper-language-toggle","paper-chart-theme-toggle"])
  assert.match(html,new RegExp('id="'+id+'"'),"Missing required UI control "+id);
 assert.match(html,/PAPER TRADING/);assert.match(html,/PAPER INVESTING/);
 assert.match(html,/NSE · BSE/);
 assert.match(html,/Upstox V3/);
});
test("Paper Investing client uses authenticated Supabase session and idempotent virtual orders",()=>{
 assert.match(js,/getIdToken/);assert.match(js,/idempotency_key/);assert.match(js,/zenura-paper-investing-order-v1/);
 assert.match(js,/\/paper\/investing\/account/);assert.match(js,/\/paper\/investing\/portfolio/);
 assert.match(js,/\/paper\/investing\/orders/);assert.match(js,/ZenuraProfessionalChart\.mount/);
 assert.doesNotMatch(js,/firebase/i);
});
test("Paper Investing server routes and SQL ledger are independent from Paper Trading",()=>{
 for(const route of ['"/paper/investing/account"','"/paper/investing/portfolio"','"/paper/investing/orders"'])
  assert.ok(gateway.includes(route),"Missing gateway route "+route);
 assert.match(migration,/paper_investing_accounts/);assert.match(migration,/paper_investing_positions/);
 assert.match(migration,/paper_investing_orders/);assert.match(migration,/execute_paper_investing_market_order/);
 assert.match(migration,/100000000/);
});
test("Paper Investing responsive styles include compact tablet and mobile layouts",()=>{
 assert.match(css,/@media\s*\(max-width:\s*1050px\)/);
 assert.match(css,/@media\s*\(max-width:\s*700px\)/);
});
