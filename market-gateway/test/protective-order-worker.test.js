"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluateProtectiveOrder,MAX_QUOTE_AGE_MS,isSupportedProtectiveOrder}=require("../lib/protective-order-worker");

const order={order_id:"a".repeat(64),user_id:"11111111-1111-4111-8111-111111111111",
 status:"ACTIVE",asset_class:"EQUITY",instrument_key:"NSE_EQ|TEST",product:"DELIVERY",
 side:"SELL",trigger_type:"STOP_LOSS",trigger_direction:"AT_OR_BELOW",
 trigger_price_paise:9500,quantity:10};
const quote={instrumentKey:"NSE_EQ|TEST",pricePaise:9400,tradeTimeMs:100000};

test("protective worker triggers stop-loss and target only in the correct exit direction",()=>{
 assert.equal(evaluateProtectiveOrder(order,quote,101000),true);
 assert.equal(evaluateProtectiveOrder({...order,trigger_type:"STOP_LOSS",trigger_direction:"AT_OR_ABOVE"},quote,101000),false);
 assert.equal(evaluateProtectiveOrder({...order,trigger_type:"TARGET",trigger_direction:"AT_OR_ABOVE",trigger_price_paise:9300},quote,101000),true);
 assert.equal(evaluateProtectiveOrder({...order,status:"CANCELLED"},quote,101000),false);
});
test("protective worker requires supported asset/product pairings and valid position exit direction",()=>{
 assert.equal(isSupportedProtectiveOrder({...order,asset_class:"FUTURE",product:"FUTURES"}),true);
 assert.equal(isSupportedProtectiveOrder({...order,asset_class:"OPTION",product:"OPTIONS"}),true);
 assert.equal(isSupportedProtectiveOrder({...order,asset_class:"CRYPTO",product:"DELIVERY"}),false);
 assert.equal(isSupportedProtectiveOrder({...order,asset_class:"FUTURE",product:"DELIVERY"}),false);
 assert.equal(isSupportedProtectiveOrder({...order,side:"BUY",trigger_type:"STOP_LOSS",trigger_direction:"AT_OR_BELOW"}),false);
 assert.equal(isSupportedProtectiveOrder({...order,side:"BUY",trigger_type:"TARGET",trigger_direction:"AT_OR_BELOW"}),true);
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
 assert.equal(evaluateProtectiveOrder({...order,user_id:null},quote,101000),false);
});
