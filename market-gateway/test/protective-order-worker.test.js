"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluateProtectiveOrder,MAX_QUOTE_AGE_MS}=require("../lib/protective-order-worker");

const order={order_id:"a",status:"ACTIVE",asset_class:"EQUITY",instrument_key:"NSE_EQ|TEST",
 product:"DELIVERY",side:"SELL",trigger_type:"STOP_LOSS",trigger_direction:"AT_OR_BELOW",
 trigger_price_paise:9500,quantity:10};
const quote={instrumentKey:"NSE_EQ|TEST",pricePaise:9400,tradeTimeMs:100000};

test("protective worker triggers only an active order when its explicit direction is met",()=>{
 assert.equal(evaluateProtectiveOrder(order,quote,101000),true);
 assert.equal(evaluateProtectiveOrder({...order,trigger_direction:"AT_OR_ABOVE"},quote,101000),false);
 assert.equal(evaluateProtectiveOrder({...order,trigger_direction:"AT_OR_ABOVE",trigger_type:"TARGET",trigger_price_paise:9300},quote,101000),true);
 assert.equal(evaluateProtectiveOrder({...order,status:"CANCELLED"},quote,101000),false);
});
test("protective worker requires exact instrument identity and fresh, non-future quotes",()=>{
 assert.equal(evaluateProtectiveOrder(order,{...quote,instrumentKey:"NSE_EQ|OTHER"},101000),false);
 assert.equal(evaluateProtectiveOrder(order,{...quote,tradeTimeMs:101001},101000),false);
 assert.equal(evaluateProtectiveOrder(order,{...quote,tradeTimeMs:101000-MAX_QUOTE_AGE_MS-1},101000),false);
 assert.equal(evaluateProtectiveOrder(order,{...quote,pricePaise:0},101000),false);
});
test("protective worker rejects malformed order values and unsupported enums",()=>{
 assert.equal(evaluateProtectiveOrder({...order,quantity:0},quote,101000),false);
 assert.equal(evaluateProtectiveOrder({...order,trigger_price_paise:1.5},quote,101000),false);
 assert.equal(evaluateProtectiveOrder({...order,asset_class:"CRYPTO"},quote,101000),false);
 assert.equal(evaluateProtectiveOrder({...order,trigger_direction:"CLOSE_ENOUGH"},quote,101000),false);
});
