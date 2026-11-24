"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
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
 assert.deepEqual(normalizePreferences({trade_confirmations:false,price_alerts:true}),{trade_confirmations:false,price_alerts:true});
 assert.throws(()=>normalizePreferences({push_enabled:true}),{status:400});
 assert.throws(()=>normalizePreferences({email_enabled:true}),{status:400});
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

test("browser admin console contains no service-role key or client-side admin bypass",()=>{
 const browser=fs.readFileSync(path.join(__dirname,"../../markets/stocks/admin.js"),"utf8");
 assert.doesNotMatch(browser,/SUPABASE_SERVICE_ROLE_KEY|service_role/i);
 assert.doesNotMatch(browser,/grant_admin|isAdmin\s*=\s*true/i);
 const router=fs.readFileSync(path.join(__dirname,"../lib/s-trade-notifications-admin-router.js"),"utf8");
 assert.match(router,/from\("s_trade_admins"\)/);
 assert.match(router,/eq\("user_id",session\.user\.id\)/);
});
