"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const server=fs.readFileSync(path.join(__dirname,"../supabase-server.js"),"utf8");

test("Supabase futures margin preview compares broker margin against unreserved cash",()=>{
  assert.match(server,/require\("\.\/lib\/available-paper-cash"\)/);
  assert.match(server,/select\("cash_paise,reserved_cash_paise,reserved_margin_paise"\)/);
  assert.match(server,/const availableCashPaise=availablePaperCash\(account\)/);
  assert.match(server,/availableVirtualCashPaise:availableCashPaise/);
  assert.match(server,/shortfallPaise:Math\.max\(margin\.requiredMarginPaise-availableCashPaise,0\)/);
  assert.doesNotMatch(server,/availableVirtualCashPaise:account\.cash_paise/);
});


test("Futures idempotent MARKET replay returns the original fill before requiring a live provider quote",()=>{
  const replayLookup=server.indexOf('from("paper_futures_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey)');
  const replayReturn=server.indexOf("idempotentReplay:true,simulationOnly:true",replayLookup);
  const providerQuote=server.indexOf("getUpstoxAccessToken(user.id)",replayLookup);
  assert.ok(replayLookup>=0,"futures idempotency lookup must exist");
  assert.ok(replayReturn>replayLookup,"stored fill must be returned on replay");
  assert.ok(providerQuote>replayReturn,"provider token/quote must only be required for a new order");
  assert.match(server,/validateDerivativeContract,normalizeTickSizePaise/);
  assert.match(server,/pricePaise:normalizeTickSizePaise\(instrument\.tick_size\)/);
});


test("Long-option idempotent replay returns the original fill before requiring a live provider quote",()=>{
  const replayLookup=server.indexOf('from("paper_derivative_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey)');
  const replayReturn=server.indexOf("idempotentReplay:true,simulationOnly:true,excludesCharges:false",replayLookup);
  const providerQuote=server.indexOf("getUpstoxAccessToken(user.id)",replayLookup);
  assert.ok(replayLookup>=0,"option idempotency lookup must exist");
  assert.ok(replayReturn>replayLookup,"stored option fill must be returned on replay");
  assert.ok(providerQuote>replayReturn,"provider token/quote must only be required for a new option order");
  assert.match(server,/pricePaise:normalizeTickSizePaise\(instrument\.tick_size\)/);
});

test("Options LIMIT and unknown order types fail closed before instrument or provider access",()=>{
  const route=server.slice(server.indexOf('app.post("/paper/derivative/orders"'),server.indexOf('app.get("/paper/derivative/orders"'));
  const orderType=route.indexOf('const orderType=String(req.body?.order_type||"MARKET").toUpperCase()');
  const reject=route.indexOf('if(orderType!=="MARKET")return res.status(400)');
  const cache=route.indexOf("ensureInstrumentCacheAvailable()");
  const token=route.indexOf("getUpstoxAccessToken(user.id)");
  const rpc=route.indexOf('execute_paper_long_option_order');
  assert.ok(orderType>=0&&reject>orderType,"unknown/Options LIMIT types must be rejected explicitly");
  assert.ok(cache>reject&&token>reject&&rpc>reject,"unsupported order types must be rejected before approval/cache/provider/database execution");
  assert.match(route,/Options LIMIT orders are not supported yet/);
});

test("Futures margin preview validates the contract and consumes its rate-limit slot before provider access",()=>{
  const route=server.slice(server.indexOf('app.post("/paper/derivative/margin-preview"'),server.indexOf('app.post("/paper/derivative/orders"'));
  const instrument=route.indexOf('const instrument=instrumentCache.find');
  const reject=route.indexOf('if(!instrument)return res.status(400)');
  const rate=route.indexOf('consume_paper_margin_preview_slot');
  const token=route.indexOf('getUpstoxAccessToken(user.id)');
  const quote=route.indexOf('getQuote(token,instrumentKey)');
  assert.ok(instrument>=0&&reject>instrument,"official instrument must be validated");
  assert.ok(rate>reject,"rate-limit slot must be consumed only after contract validation");
  assert.ok(token>rate&&quote>token,"provider credentials and quote must only be requested after rate limiting");
});

test("unknown Futures order types fail closed and LIMIT submission remains behind its feature flag",()=>{
  const route=server.slice(server.indexOf('app.post("/paper/futures/orders"'),server.indexOf('app.post("/paper/futures/orders/:orderId/cancel"'));
  const orderType=route.indexOf('const orderType=String(req.body?.order_type||"MARKET").toUpperCase()');
  const reject=route.indexOf('if(!["MARKET","LIMIT"].includes(orderType))');
  const limitGate=route.indexOf('if(process.env.PAPER_FUTURES_LIMIT_ENABLED!=="true")');
  const session=route.indexOf("loadVerifiedExchangeSession(serviceDb,instrument.exchange,submitNowMs)");
  const margin=route.indexOf('https://api.upstox.com/v2/charges/margin');
  assert.ok(orderType>=0&&reject>orderType,"unknown order types must be rejected explicitly");
  assert.ok(limitGate>reject&&session>limitGate&&margin>session,"LIMIT session and margin provider calls must remain behind the explicit feature flag");
  assert.match(route,/Futures LIMIT submission is currently disabled/);
});

 
test("Futures portfolio withholds aggregate P&L and equity when any open-position quote is stale",()=>{
  const route=server.slice(server.indexOf('app.get("/paper/futures/portfolio"'),server.indexOf('// Paper Investing routes'));
  assert.match(route,/unrealizedPnlPaise:stalePositions\?null:unrealizedPnlPaise/);
  assert.match(route,/equityPaise:stalePositions\?null:account\.cash_paise\+unrealizedPnlPaise/);
  assert.match(route,/valuationStatus:stalePositions\?"partial_stale":"fresh"/);
  const ui=fs.readFileSync(path.join(__dirname,"../../markets/stocks/stocks.js"),"utf8");
  assert.match(ui,/Stale\/unavailable quotes for .*Aggregate unrealized P&L and equity are withheld/);
});

test("Futures order margin is based on the full submitted quantity, not a stale pre-transaction position read",()=>{
  const route=server.slice(server.indexOf('app.post("/paper/futures/orders"'),server.indexOf('app.get("/paper/futures/orders"'));
  assert.match(route,/quantity:contract\.quantity,product:product==="INTRADAY"\?"I":"D",transaction_type:side/);
  assert.match(route,/from\("paper_futures_positions"\)/);
  assert.match(route,/const closesEntireOrder=/);
  assert.match(route,/if\(!closesEntireOrder\)/);
  assert.doesNotMatch(route,/const openingQuantity=/);
  assert.match(route,/pre-transaction position snapshot/);
  assert.match(route,/SQL transaction would open exposure, the SQL ledger/i);
  assert.match(route,/marginEstimateScope:"full_submitted_quantity_conservative_on_reversal"/);
  const ui=fs.readFileSync(path.join(__dirname,"../../markets/stocks/stocks.js"),"utf8");
  assert.match(ui,/Conservative order-quantity margin estimate/);
});
