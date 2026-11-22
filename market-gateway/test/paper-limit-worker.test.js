"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isEligiblePaperLimitOrder,isEligibleCryptoLimitOrder,normalizeWorkerCursor,groupOrdersByUser}=require("../lib/paper-limit-worker");

const base={order_type:"LIMIT",status:"PENDING",simulation_only:true,product:"DELIVERY",
 user_id:"11111111-1111-4111-8111-111111111111",instrument_key:"NSE_EQ|TEST",
 side:"BUY",quantity:10,limit_price_paise:10000};
const quote={pricePaise:9900,tradeTimeMs:100000,quoteAgeMs:1000};

test("LIMIT worker fills only matching fresh, pending, simulation-only delivery orders",()=>{
 assert.equal(isEligiblePaperLimitOrder(base,quote,101000),true);
 assert.equal(isEligiblePaperLimitOrder({...base,side:"SELL"},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,side:"SELL",limit_price_paise:9800},quote,101000),true);
 assert.equal(isEligiblePaperLimitOrder({...base,status:"CANCELLED"},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,simulation_only:false},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,product:"INTRADAY"},quote,101000),false);
});
test("LIMIT worker rejects stale, future-dated and malformed quotes",()=>{
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:85000},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:101001},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,pricePaise:0},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:NaN},101000),false);
});
test("LIMIT worker cursor is reset unless both ordered cursor fields are valid",()=>{
 assert.deepEqual(normalizeWorkerCursor({cursor_created_at:"2026-11-22T10:00:00.000Z",cursor_order_id:"a".repeat(64)}),
  {createdAt:"2026-11-22T10:00:00.000Z",orderId:"a".repeat(64)});
 assert.deepEqual(normalizeWorkerCursor({cursor_created_at:"bad",cursor_order_id:"a".repeat(64)}),{createdAt:null,orderId:null});
});
test("LIMIT worker groups pending orders by verified user id",()=>{
 const groups=groupOrdersByUser([base,{...base,order_id:"b".repeat(64)},{...base,user_id:"22222222-2222-4222-8222-222222222222"},{...base,user_id:null}]);
 assert.equal(groups.size,2);
 assert.equal(groups.get(base.user_id).length,2);
});

const cryptoLimit={order_type:"LIMIT",status:"PENDING",simulation_only:true,
 user_id:"11111111-1111-4111-8111-111111111111",symbol:"BTCUSDT",side:"BUY",
 quantity:"0.001",limit_price:"90000"};
const cryptoQuote={priceUsdt:89900,tradeTimeMs:100000};
test("crypto LIMIT worker requires pending simulation order and favorable fresh quote",()=>{
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,cryptoQuote,101000),true);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,side:"SELL"},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,side:"SELL",limit_price:"89000"},cryptoQuote,101000),true);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,status:"CANCELLED"},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,simulation_only:false},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,symbol:"BTC"},cryptoQuote,101000),false);
});
test("crypto LIMIT worker rejects stale, future-dated and malformed quotes",()=>{
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,tradeTimeMs:85000},101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,tradeTimeMs:101001},101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,priceUsdt:0},101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,tradeTimeMs:NaN},101000),false);
});
test("crypto LIMIT worker rejects non-decimal quantities and non-numeric provider prices",()=>{
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,quantity:true},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,limit_price:[]},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder({...cryptoLimit,quantity:"0.0000000000001"},cryptoQuote,101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,priceUsdt:true},101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,{...cryptoQuote,priceUsdt:"89900"},101000),false);
 assert.equal(isEligibleCryptoLimitOrder(cryptoLimit,cryptoQuote,101000),true);
});
