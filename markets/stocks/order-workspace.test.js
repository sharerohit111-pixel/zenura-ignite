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
  assert.match(source,/\['PENDING','FILLED','CANCELLED'\]\.includes\(data\.status\)/);
  assert.match(source,/return \{storageError:true\}/);
  assert.match(source,/pending\?\.storageError/);
  assert.match(source,/No order was sent; resolve browser storage/);
  assert.match(source,/localStorage\.getItem\(limitStorageKey\(uid\)\)/);
  assert.match(source,/localStorage\.setItem\(limitStorageKey\(uid\), JSON\.stringify\(pending\)\)/);
  assert.doesNotMatch(source,/sessionStorage\.(getItem|setItem|removeItem)\(limitStorageKey/);
  assert.match(gateway,/orderType==="LIMIT"/);
  assert.match(gateway,/placePendingLimitOrder/);
  assert.match(gateway,/Only MARKET and LIMIT paper orders are supported/);
});

test("Successful LIMIT response keeps its idempotency key until account refresh completes",()=>{
  const start=source.indexOf("async function submitLimitOrder");
  const end=source.indexOf("function orderRow",start);
  const submit=source.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(submit.indexOf("await refreshAll();")>=0);
  assert.ok(submit.indexOf("clearPendingLimit(uid);")>submit.indexOf("await refreshAll();"));
});

test("LIMIT mode intercepts BUY/SELL before legacy MARKET handlers",()=>{
  assert.ok(source.includes("[buy, sell].forEach((button, index) => button.addEventListener('click'"));
  assert.ok(source.includes("if (selectedType !== 'LIMIT') return;"));
  assert.ok(source.includes("event.stopImmediatePropagation()"));
  assert.ok(source.includes("}, true));"));
  assert.ok(source.includes("submitLimitOrder(index === 0 ? 'BUY' : 'SELL')"));
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
  assert.match(source,/String\(order\.status\)\.toUpperCase\(\) === 'FILLED'/);
  assert.match(source,/String\(order\.status\)\.toUpperCase\(\) === currentFilter/);
  assert.match(gateway,/nextCursor:hasMore\?/);
});

test("Backend scheduled worker checks pending LIMIT orders every minute",()=>{
  assert.match(worker,/processPendingPaperLimitOrders/);
  assert.ok(worker.includes('schedule:"*/1 9-15 * * 1-5"'));
  assert.match(worker,/isIndianCashMarketOpen\(now\)/);
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

test("Hindi validation, retry-safety, submission and cancellation messages are translated",()=>{
  const cases=[
    ["Enter a whole-number quantity between 1 and 1,000,000.","1 से 1,000,000 के बीच पूर्ण संख्या में मात्रा दर्ज करें।"],
    ["Enter a valid positive limit price (maximum 2 decimal places).","सही धनात्मक लिमिट कीमत दर्ज करें (अधिकतम 2 दशमलव स्थान)।"],
    ["Saved LIMIT retry data is unreadable. No order was sent; resolve browser storage before placing another LIMIT order.","सहेजा गया LIMIT retry डेटा पढ़ा नहीं जा सका। कोई ऑर्डर नहीं भेजा गया; नया LIMIT ऑर्डर देने से पहले ब्राउज़र स्टोरेज ठीक करें।"],
    ["LIMIT order submitted and reservation confirmed.","LIMIT ऑर्डर जमा हुआ और आरक्षण की पुष्टि हुई।"],
    ["Pending LIMIT order could not be cancelled.","पेंडिंग LIMIT ऑर्डर रद्द नहीं हो सका।"],
    ["Order cancellation failed.","ऑर्डर रद्द करने में विफलता हुई।"],
    ["Order history unavailable.","ऑर्डर हिस्ट्री उपलब्ध नहीं है।"]
  ];
  for(const [english,hindi] of cases){
    assert.ok(source.includes("'"+english+"':'"+hindi+"'"),"missing Hindi translation: "+english);
    const translatedDirectly=source.includes("translate('"+english+"')");
    const translatedAsResult=english==="LIMIT order submitted and reservation confirmed." && source.includes("translate(resultMessage)");
    assert.ok(translatedDirectly || translatedAsResult,"message is not routed through translate(): "+english);
  }
});
