"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePriceAlert,normalizePreferences,safeAdminReason,isProvider,isAdminAction}=require("../lib/s-trade-notifications-admin");

test("validates and normalizes bounded price alert inputs",()=>{
 assert.deepEqual(normalizePriceAlert({instrumentKey:"NSE_EQ|INE001",symbol:"ABC",condition:"above",targetPrice:"123.45"}),
 {instrument_key:"NSE_EQ|INE001",display_symbol:"ABC",condition:"above",target_price:123.45});
 for(const value of [
  {},{instrumentKey:"x".repeat(101),symbol:"A",condition:"above",targetPrice:10},
  {instrumentKey:"A",symbol:"B",condition:"sideways",targetPrice:10},
  {instrumentKey:"A",symbol:"B",condition:"above",targetPrice:0},
  {instrumentKey:"A",symbol:"B",condition:"below",targetPrice:1e12},
  {instrumentKey:"A\n",symbol:"B",condition:"above",targetPrice:10}
 ])assert.throws(()=>normalizePriceAlert(value),{status:400});
});

test("preference updates accept only explicit boolean allowlisted keys",()=>{
 assert.deepEqual(normalizePreferences({trade_confirmations:false,push_enabled:true}),{trade_confirmations:false,push_enabled:true});
 assert.throws(()=>normalizePreferences({is_admin:true}),{status:400});
 assert.throws(()=>normalizePreferences({email_enabled:"true"}),{status:400});
 assert.throws(()=>normalizePreferences([]),{status:400});
});

test("admin reasons and action/provider identifiers are allowlisted",()=>{
 assert.equal(safeAdminReason("security incident review"),"security incident review");
 assert.equal(safeAdminReason("no"),null);
 assert.equal(isProvider("upstox"),true);
 assert.equal(isProvider("arbitrary-url"),false);
 assert.equal(isAdminAction("provider_control"),true);
 assert.equal(isAdminAction("grant_admin"),false);
});
