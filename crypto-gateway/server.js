"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT || 8081);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
const CRYPTO_SYMBOLS = new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","PAXGUSDT","XAUTUSDT"]);
const FEE_RATE = 0.001;
const MAX_QUANTITY = 1e9;
const MAX_ORDER_INR = 1e12;
const QUOTE_MAX_AGE_MS = 15000;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Crypto gateway requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY.");
}
const projectUrl = new URL(SUPABASE_URL);
if (projectUrl.protocol !== "https:" || projectUrl.pathname !== "/" || projectUrl.search || projectUrl.hash) {
  throw new Error("SUPABASE_URL must be an HTTPS Supabase project origin.");
}
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const serviceDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);

function httpError(message, status) { return Object.assign(new Error(message), { status }); }
function readBearer(req) {
  const m = /^Bearer ([^\s,]+)$/i.exec(req.get("authorization") || "");
  if (!m) throw httpError("Sign in required.", 401);
  return m[1];
}
function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function sendError(res, error, fallback) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: status >= 500 ? fallback : error.message });
}
async function authenticate(req) {
  const token = readBearer(req);
  let result;
  try { result = await serviceDb.auth.getUser(token); }
  catch { throw httpError("Authentication service is temporarily unavailable.", 503); }
  const user = result?.data?.user;
  if (result?.error || !user || !isUuid(user.id)) throw httpError("Supabase session is invalid or expired.", 401);
  const userDb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    ...clientOptions, global: { headers: { Authorization: "Bearer " + token } }
  });
  return { user: { id: user.id }, userDb };
}
async function userRpc(user, name, args) {
  const allowed = new Set(["initialize_paper_crypto_account","execute_paper_crypto_market_order","create_paper_crypto_limit_order","cancel_paper_crypto_limit_order","reset_paper_crypto_account","create_paper_crypto_risk_plan","cancel_paper_crypto_risk_plan"]);
  if (!allowed.has(name)) throw httpError("Crypto operation is not allowlisted.", 400);
  const result = await serviceDb.rpc(name, { ...args, p_user_id: user.id });
  if (result?.error) {
    const e = httpError("Crypto paper account operation could not be completed.", 409);
    e.code = result.error.code;
    throw e;
  }
  return result.data;
}
async function providerJson(url, timeoutMs = 5000) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw httpError("Market data provider is temporarily unavailable.", 502);
  return response.json();
}
async function getFxRate() {
  const fx = await providerJson("https://open.er-api.com/v6/latest/USD");
  const rate = Number(fx?.rates?.INR);
  if (fx?.result !== "success" || !Number.isFinite(rate) || rate < 40 || rate > 200) throw httpError("A valid USD/INR reference rate is unavailable.", 502);
  return rate;
}
function isFreshCryptoQuote(quote, nowMs=Date.now()) {
  return Number.isFinite(quote?.priceUsdt) && quote.priceUsdt>0
    && Number.isSafeInteger(quote?.tradeTimeMs) && quote.tradeTimeMs<=nowMs
    && nowMs-quote.tradeTimeMs<=QUOTE_MAX_AGE_MS;
}
function getRiskPlanTrigger(plan, priceUsdt) {
  if (!Number.isFinite(priceUsdt)||priceUsdt<=0) return null;
  if (plan?.stop_loss_price!==null && plan?.stop_loss_price!==undefined && priceUsdt<=Number(plan.stop_loss_price)) return "STOP_LOSS";
  if (plan?.take_profit_price!==null && plan?.take_profit_price!==undefined && priceUsdt>=Number(plan.take_profit_price)) return "TAKE_PROFIT";
  return null;
}
function validateOrderInput(body, limit = false) {
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase() : "";
  const side = String(body?.side || "").toUpperCase();
  const quantityRaw = String(body?.quantity ?? "");
  const priceRaw = String(body?.limit_price ?? "");
  const key = String(body?.idempotency_key || "");
  if (!CRYPTO_SYMBOLS.has(symbol)) throw httpError("Select a supported Crypto spot symbol.", 400);
  if (!["BUY","SELL"].includes(side)) throw httpError("Only BUY and SELL are supported.", 400);
  if (!isUuid(key)) throw httpError("A valid UUID idempotency_key is required.", 400);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(quantityRaw) || !Number.isFinite(Number(quantityRaw)) || Number(quantityRaw) <= 0 || Number(quantityRaw) > MAX_QUANTITY) throw httpError("Enter a valid quantity with up to 12 decimal places.", 400);
  if (limit && (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(priceRaw) || !Number.isFinite(Number(priceRaw)) || Number(priceRaw) <= 0 || Number(priceRaw) > MAX_QUANTITY)) throw httpError("Enter a valid LIMIT price with up to 8 decimal places.", 400);
  return { symbol, side, quantityRaw, priceRaw, key };
}
function validateRiskPlanInput(body) {
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase() : "";
  const quantity = String(body?.quantity ?? "");
  const stopLossPrice = body?.stop_loss_price == null || body.stop_loss_price === "" ? null : String(body.stop_loss_price);
  const takeProfitPrice = body?.take_profit_price == null || body.take_profit_price === "" ? null : String(body.take_profit_price);
  const key = String(body?.idempotency_key || "");
  const validDecimal = (value, precision) => value === null || (
    new RegExp("^(?:0|[1-9]\\d*)(?:\\.\\d{1,"+precision+"})?$").test(value)
    && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= MAX_QUANTITY
  );
  if (!CRYPTO_SYMBOLS.has(symbol) || !validDecimal(quantity,12) || !isUuid(key)
      || !validDecimal(stopLossPrice,8) || !validDecimal(takeProfitPrice,8)
      || (stopLossPrice === null && takeProfitPrice === null)
      || (stopLossPrice !== null && takeProfitPrice !== null && Number(stopLossPrice) >= Number(takeProfitPrice))) {
    throw httpError("Enter a valid Crypto quantity, SL/Target prices and idempotency key.",400);
  }
  return {symbol,quantity,stopLossPrice,takeProfitPrice,key};
}

function makeOrderId(userId, key) {
  const hex = crypto.createHash("sha256").update(userId + ":" + key).digest("hex").slice(0,32).split("");
  hex[12] = "5"; hex[16] = ((parseInt(hex[16],16) & 3) | 8).toString(16);
  const v = hex.join("");
  return v.slice(0,8)+"-"+v.slice(8,12)+"-"+v.slice(12,16)+"-"+v.slice(16,20)+"-"+v.slice(20);
}
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb", strict: true }));
app.use((req,res,next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin && ALLOWED_ORIGINS.includes(origin) ? 204 : 403);
  next();
});
// Per-process abuse guard for state-changing HTTP routes. Uses the socket peer address
// (not caller-controlled forwarding headers); a shared edge limiter is still required for multi-replica deployments.
function createRateLimiter({ windowMs = 60000, max = 30, maxKeys = 10000, now = Date.now } = {}) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const key = req.socket?.remoteAddress || "unknown";
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || time - bucket.startedAt >= windowMs) {
      if (!bucket && buckets.size >= maxKeys) {
        for (const [address, entry] of buckets) if (time - entry.startedAt >= windowMs) buckets.delete(address);
        if (buckets.size >= maxKeys) return res.set("Cache-Control", "no-store").status(503).json({ error: "Request capacity is temporarily limited." });
      }
      bucket = { startedAt: time, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retrySeconds = Math.max(1, Math.ceil((windowMs - (time - bucket.startedAt)) / 1000));
      return res.set("Cache-Control", "no-store").set("Retry-After", String(retrySeconds)).status(429).json({ error: "Too many Crypto order requests. Retry later." });
    }
    next();
  };
}
const cryptoOrderRateLimit = createRateLimiter({ windowMs: 60000, max: 30 });

app.get("/health", (_req,res) => res.set("Cache-Control","no-store").json({ ok:true, service:"zenura-crypto-paper-gateway", simulationOnly:true }));
app.get("/crypto/account", async(req,res) => {
  try {
    const { user, userDb } = await authenticate(req);
    const initialized = await userRpc(user,"initialize_paper_crypto_account",{p_starting_cash_inr:"1000000"});
    const { data, error } = await userDb.from("paper_crypto_accounts").select("*").eq("user_id",user.id).maybeSingle();
    if (error || !data) throw httpError("Crypto paper account could not be initialized or read.",503);
    res.set("Cache-Control","private, no-store").json({ currency:data.currency,cashBalance:data.cash_balance,startingCash:data.starting_cash,realizedPnl:data.realized_pnl,version:data.version,created:initialized?.created===true,simulationOnly:true });
  } catch(e) { sendError(res,e,"Crypto paper account could not be loaded."); }
});
app.post("/crypto/account/reset", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const requestId = String(req.body?.request_id || "");
    if (!isUuid(requestId)) throw httpError("A valid reset request UUID is required.",400);
    const result = await userRpc(user,"reset_paper_crypto_account",{p_request_id:requestId});
    res.set("Cache-Control","private, no-store").json({
      resetId:result?.reset_id,
      cashBalance:result?.cash_balance,
      cancelledLimitOrders:result?.cancelled_limit_orders,
      closedPositions:result?.closed_positions,
      idempotentReplay:result?.idempotent_replay===true,
      historyPreserved:result?.history_preserved===true,
      simulationOnly:result?.simulation_only===true
    });
  } catch(e) { sendError(res,e,"Crypto paper account reset could not be completed."); }
});
app.get("/crypto/portfolio", async(req,res) => {
  try {
    const { user, userDb } = await authenticate(req);
    const [a,p,o] = await Promise.all([
      userDb.from("paper_crypto_accounts").select("*").eq("user_id",user.id).maybeSingle(),
      userDb.from("paper_crypto_positions").select("*").eq("user_id",user.id).order("symbol"),
      userDb.from("paper_crypto_orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100)
    ]);
    if (a.error || p.error || o.error) throw httpError("Crypto portfolio could not be loaded.",503);
    if (!a.data) throw httpError("Crypto paper account has not been initialized.",404);
    res.set("Cache-Control","private, no-store").json({
      account:{currency:a.data.currency,cashBalance:a.data.cash_balance,reservedCash:a.data.reserved_cash,availableCash:Number(a.data.cash_balance)-Number(a.data.reserved_cash||0),realizedPnl:a.data.realized_pnl},
      positions:p.data||[],orders:o.data||[],simulationOnly:true
    });
  } catch(e) { sendError(res,e,"Crypto portfolio could not be loaded."); }
});
app.post("/crypto/orders", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const {symbol,side,quantityRaw,key} = validateOrderInput(req.body);
    const [trades,fxRate] = await Promise.all([
      providerJson("https://api.binance.com/api/v3/trades?"+new URLSearchParams({symbol,limit:"1"})),
      getFxRate()
    ]);
    const trade = Array.isArray(trades) ? trades[0] : null;
    const price = Number(trade?.price), quoteTimestamp = Number(trade?.time);
    const age = Date.now()-quoteTimestamp;
    if (!Number.isFinite(price)||price<=0||!Number.isSafeInteger(quoteTimestamp)||age < -2000||age > QUOTE_MAX_AGE_MS) throw httpError("A fresh Binance quote is not available. Retry shortly.",409);
    const gross = Number(quantityRaw)*price*fxRate;
    if (!Number.isFinite(gross)||gross<=0||gross>MAX_ORDER_INR) throw httpError("Order value is outside supported limits.",400);
    const fee = Number((gross*FEE_RATE).toFixed(8));
    const orderId = makeOrderId(user.id,key);
    const fp = fingerprint({userId:user.id,symbol,side,quantity:quantityRaw});
    const result = await userRpc(user,"execute_paper_crypto_market_order",{
      p_order_id:orderId,p_idempotency_key:key,p_request_fingerprint:fp,p_symbol:symbol,p_base_asset:symbol.slice(0,-4),
      p_side:side,p_quantity:quantityRaw,p_execution_price:price.toFixed(8),p_fx_rate_inr:fxRate.toFixed(8),
      p_fee:fee.toFixed(8),p_quote_timestamp_ms:quoteTimestamp
    });
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      orderId:result?.order?.order_id||orderId,status:result?.order?.status||"FILLED",symbol,side,quantity:quantityRaw,
      executionPriceUsdt:price,fxRateInr:fxRate,grossInr:Number(gross.toFixed(8)),feeInr:fee,
      cashBalance:result?.cash_balance,realizedPnl:result?.realized_pnl,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  } catch(e) { sendError(res,e,"Crypto paper order could not be completed."); }
});
app.post("/crypto/limit-orders", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const {symbol,side,quantityRaw,priceRaw,key} = validateOrderInput(req.body,true);
    const fxRate = await getFxRate();
    const gross = Number(quantityRaw)*Number(priceRaw)*fxRate;
    if (!Number.isFinite(gross)||gross<=0||gross>MAX_ORDER_INR) throw httpError("LIMIT reservation is outside supported limits.",400);
    const fee = Number((gross*FEE_RATE).toFixed(8));
    const orderId = makeOrderId(user.id,key);
    const fp = fingerprint({userId:user.id,symbol,side,quantity:quantityRaw,orderType:"LIMIT",limitPrice:priceRaw});
    await userRpc(user,"initialize_paper_crypto_account",{p_starting_cash_inr:"1000000"});
    const result = await userRpc(user,"create_paper_crypto_limit_order",{
      p_order_id:orderId,p_idempotency_key:key,p_request_fingerprint:fp,p_symbol:symbol,p_base_asset:symbol.slice(0,-4),
      p_side:side,p_quantity:quantityRaw,p_limit_price:priceRaw,p_fx_rate_inr:fxRate.toFixed(8),p_fee:fee.toFixed(8)
    });
    const order = result?.order||{};
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      orderId:order.order_id||orderId,status:order.status||"PENDING",orderType:"LIMIT",symbol,side,quantity:quantityRaw,
      limitPriceUsdt:priceRaw,reservedInr:order.reserved_amount??0,cashBalance:result?.cash_balance,
      reservedCash:result?.reserved_cash,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  } catch(e) { sendError(res,e,"Crypto LIMIT order could not be created."); }
});
app.get("/crypto/risk-plans", async(req,res) => {
  try {
    const { user, userDb } = await authenticate(req);
    const result = await userDb.from("paper_crypto_risk_plans")
      .select("plan_id,symbol,quantity,stop_loss_price,take_profit_price,status,created_at,updated_at")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
    if (result.error) throw httpError("Crypto SL/Target plans could not be loaded.",503);
    res.set("Cache-Control","private, no-store").json({plans:result.data||[],simulationOnly:true});
  } catch(e) { sendError(res,e,"Crypto SL/Target plans could not be loaded."); }
});
app.post("/crypto/risk-plans", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const {symbol,quantity,stopLossPrice:slRaw,takeProfitPrice:tpRaw,key} = validateRiskPlanInput(req.body);
    const planId = makeOrderId(user.id,key);
    const result = await userRpc(user,"create_paper_crypto_risk_plan",{
      p_plan_id:planId,p_idempotency_key:key,p_symbol:symbol,p_base_asset:symbol.slice(0,-4),
      p_quantity:quantity,p_stop_loss_price:slRaw,p_take_profit_price:tpRaw
    });
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      planId:result?.plan?.plan_id||planId,status:result?.plan?.status||"ACTIVE",
      symbol,quantity,stopLossPrice:slRaw,takeProfitPrice:tpRaw,
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  } catch(e) { sendError(res,e,"Crypto SL/Target plan could not be saved."); }
});
app.post("/crypto/risk-plans/:planId/cancel", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const planId = String(req.params.planId||"");
    if (!isUuid(planId)) throw httpError("A valid Crypto risk plan ID is required.",400);
    const result = await userRpc(user,"cancel_paper_crypto_risk_plan",{p_plan_id:planId});
    res.set("Cache-Control","private, no-store").json({
      planId:result?.plan?.plan_id||planId,status:result?.plan?.status||"CANCELLED",
      cancelled:result?.cancelled===true,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  } catch(e) { sendError(res,e,"Crypto SL/Target plan could not be cancelled."); }
});

app.post("/crypto/limit-orders/:orderId/cancel", cryptoOrderRateLimit, async(req,res) => {
  try {
    const { user } = await authenticate(req);
    const orderId = String(req.params.orderId||"");
    if (!isUuid(orderId)) throw httpError("A valid Crypto order ID is required.",400);
    const result = await userRpc(user,"cancel_paper_crypto_limit_order",{p_order_id:orderId});
    res.set("Cache-Control","private, no-store").json({orderId:result?.order?.order_id||orderId,status:result?.order?.status||"CANCELLED",cancelled:result?.cancelled===true,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true});
  } catch(e) { sendError(res,e,"Crypto LIMIT order could not be cancelled."); }
});

// One lease covers both LIMIT orders and SL/Target plans. Keep each side to five
// records so worst-case provider quote timeouts cannot consume the full 120-second lease.
async function rotateRiskPlanSafely(update, log=console.error) {
  try {
    const result=await update();
    if(result?.error) {
      log("Crypto SL/Target worker plan rotation failed.");
      return false;
    }
    return true;
  } catch {
    log("Crypto SL/Target worker plan rotation failed; plan remains eligible for the next scan.");
    return false;
  }
}
async function releaseWorkerLeaseSafely(releaseLease, log=console.error) {
  try {
    const result=await releaseLease();
    if(result?.error) log("Crypto LIMIT worker lease release failed.");
  } catch {
    log("Crypto LIMIT worker lease release failed; the bounded lease will expire.");
  }
}

async function runLimitWorker({maxOrders=5}={}) {
  if (!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>5) throw new TypeError("Crypto worker batch size must be between 1 and 5 to stay within the 120-second lease.");
  const leaseToken=crypto.randomUUID(), now=Date.now();
  const lease=await serviceDb.rpc("acquire_paper_crypto_limit_worker_lease",{p_lease_token:leaseToken,p_now_ms:now,p_ttl_ms:120000});
  if (lease.error) throw new Error("Crypto LIMIT worker lease could not be acquired.");
  if (lease.data!==true) return {locked:true,scanned:0,filled:0,notEligible:0,failed:0};
  const summary={locked:false,scanned:0,filled:0,notEligible:0,failed:0};
  try {
    const state=await serviceDb.from("paper_crypto_limit_worker_state").select("cursor_created_at,cursor_order_id").eq("state_key","crypto_limit_orders").maybeSingle();
    if (state.error) throw new Error("Crypto LIMIT worker cursor could not be read.");
    let cursor=state.data||{};
    const loadBatch=pos=>{
      let q=serviceDb.from("paper_crypto_orders").select("order_id,user_id,symbol,base_asset,side,order_type,status,quantity,limit_price,simulation_only,created_at")
        .eq("order_type","LIMIT").eq("status","PENDING").eq("simulation_only",true).order("created_at",{ascending:true}).order("order_id",{ascending:true}).limit(maxOrders);
      if(pos.cursor_created_at&&pos.cursor_order_id) q=q.or("created_at.gt."+pos.cursor_created_at+",and(created_at.eq."+pos.cursor_created_at+",order_id.gt."+pos.cursor_order_id+")");
      return q;
    };
    let batch=await loadBatch(cursor);
    if(batch.error) throw new Error("Pending Crypto LIMIT orders could not be scanned.");
    if(!(batch.data||[]).length&&(cursor.cursor_created_at||cursor.cursor_order_id)) {
      cursor={cursor_created_at:null,cursor_order_id:null};
      const reset=await serviceDb.from("paper_crypto_limit_worker_state").update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()}).eq("state_key","crypto_limit_orders").eq("lease_token",leaseToken);
      if(reset.error) throw new Error("Crypto LIMIT worker cursor reset failed.");
      batch=await loadBatch(cursor);
      if(batch.error) throw new Error("Pending Crypto LIMIT orders could not be rescanned.");
    }
    const orders=batch.data||[]; summary.scanned=orders.length;
    let fxRate=null; const quoteCache=new Map();
    for(const order of orders) {
      try {
        if(!CRYPTO_SYMBOLS.has(order.symbol)||order.base_asset!==order.symbol.slice(0,-4)) { summary.notEligible++; continue; }
        let quote=quoteCache.get(order.symbol);
        if(!quote) {
          const trades=await providerJson("https://api.binance.com/api/v3/trades?"+new URLSearchParams({symbol:order.symbol,limit:"1"}));
          const trade=Array.isArray(trades)?trades[0]:null;
          quote={priceUsdt:Number(trade?.price),tradeTimeMs:Number(trade?.time)}; quoteCache.set(order.symbol,quote);
        }
        const nowMs=Date.now();
        if(!isFreshCryptoQuote(quote,nowMs)) { summary.notEligible++; continue; }
        const eligible=order.side==="BUY"?quote.priceUsdt<=Number(order.limit_price):quote.priceUsdt>=Number(order.limit_price);
        if(!eligible) { summary.notEligible++; continue; }
        if(fxRate===null) fxRate=await getFxRate();
        const gross=Number(order.quantity)*quote.priceUsdt*fxRate;
        if(!Number.isFinite(gross)||gross<=0||gross>MAX_ORDER_INR) { summary.notEligible++; continue; }
        const fee=Number((gross*FEE_RATE).toFixed(8));
        const filled=await serviceDb.rpc("fill_paper_crypto_limit_order",{p_user_id:order.user_id,p_order_id:order.order_id,p_execution_price:quote.priceUsdt.toFixed(8),p_fx_rate_inr:fxRate.toFixed(8),p_fee:fee.toFixed(8),p_quote_timestamp_ms:quote.tradeTimeMs});
        if(filled.error) { summary.failed++; continue; }
        if(filled.data?.order?.status==="FILLED") summary.filled++; else summary.notEligible++;
      } catch { summary.failed++; }
    }
    // SL/Target plans use the same exclusive Crypto worker lease as LIMIT orders.
    // Their quantity was reserved at plan creation; the SQL exit RPC consumes only that reserve.
    const riskBatch=await serviceDb.from("paper_crypto_risk_plans")
      .select("plan_id,user_id,symbol,base_asset,quantity,stop_loss_price,take_profit_price")
      .eq("status","ACTIVE").order("updated_at",{ascending:true}).order("plan_id",{ascending:true}).limit(maxOrders);
    if(riskBatch.error) throw new Error("Active Crypto SL/Target plans could not be scanned.");
    summary.riskScanned=riskBatch.data?.length||0;
    for(const plan of riskBatch.data||[]) {
      try {
        if(!CRYPTO_SYMBOLS.has(plan.symbol)||plan.base_asset!==plan.symbol.slice(0,-4)) { summary.notEligible++; continue; }
        let quote=quoteCache.get(plan.symbol);
        if(!quote) {
          const trades=await providerJson("https://api.binance.com/api/v3/trades?"+new URLSearchParams({symbol:plan.symbol,limit:"1"}));
          const trade=Array.isArray(trades)?trades[0]:null;
          quote={priceUsdt:Number(trade?.price),tradeTimeMs:Number(trade?.time)}; quoteCache.set(plan.symbol,quote);
        }
        const nowMs=Date.now();
        if(!isFreshCryptoQuote(quote,nowMs)) { summary.notEligible++; continue; }
        const trigger=getRiskPlanTrigger(plan,quote.priceUsdt);
        if(!trigger) { summary.notEligible++; continue; }
        if(fxRate===null) fxRate=await getFxRate();
        const gross=Number(plan.quantity)*quote.priceUsdt*fxRate;
        if(!Number.isFinite(gross)||gross<=0||gross>MAX_ORDER_INR) { summary.failed++; continue; }
        const fee=Number((gross*FEE_RATE).toFixed(8));
        const executed=await serviceDb.rpc("execute_paper_crypto_risk_exit",{
          p_user_id:plan.user_id,p_plan_id:plan.plan_id,p_execution_price:quote.priceUsdt.toFixed(8),
          p_fx_rate_inr:fxRate.toFixed(8),p_fee:fee.toFixed(8),p_quote_timestamp_ms:quote.tradeTimeMs
        });
        if(executed.error) { summary.failed++; continue; }
        if(executed.data?.plan?.status==="EXECUTED") summary.riskExecuted=(summary.riskExecuted||0)+1;
        else summary.notEligible++;
      } catch { summary.failed++; }
      finally {
        const rotated=await rotateRiskPlanSafely(
          ()=>serviceDb.from("paper_crypto_risk_plans").update({updated_at:new Date().toISOString()})
            .eq("plan_id",plan.plan_id).eq("status","ACTIVE")
        );
        if(!rotated) summary.failed++;
      }
    }
    if(orders.length) {
      const last=orders[orders.length-1];
      const saved=await serviceDb.from("paper_crypto_limit_worker_state").update({cursor_created_at:last.created_at,cursor_order_id:last.order_id,updated_at:new Date().toISOString()}).eq("state_key","crypto_limit_orders").eq("lease_token",leaseToken);
      if(saved.error) throw new Error("Crypto LIMIT worker cursor could not be saved.");
    } else {
      const saved=await serviceDb.from("paper_crypto_limit_worker_state").update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()}).eq("state_key","crypto_limit_orders").eq("lease_token",leaseToken);
      if(saved.error) throw new Error("Crypto LIMIT worker cursor could not be reset.");
    }
    return summary;
  } finally {
    // A failed cleanup must never mask the worker result/error; lease TTL is the fallback.
    await releaseWorkerLeaseSafely(
      ()=>serviceDb.rpc("release_paper_crypto_limit_worker_lease",{p_lease_token:leaseToken,p_now_ms:Date.now()})
    );
  }
}

const workerIntervalMs=Math.min(Math.max(Number(process.env.CRYPTO_LIMIT_WORKER_INTERVAL_MS||5000),1000),60000);
let workerTimer=null;
// Avoid repeatedly hitting the database lease while a slow provider-bound cycle is still running.
function createSingleFlightTask(task) {
  let running=false;
  return async(...args)=>{
    if(running) return false;
    running=true;
    try { await task(...args); return true; }
    finally { running=false; }
  };
}
async function start() {
  const host=process.env.HOST||"0.0.0.0";
  const server=app.listen(PORT,host,()=>console.log("ZENURA Crypto paper gateway listening on "+PORT));
  if (process.env.CRYPTO_LIMIT_WORKER_ENABLED==="true") {
    const tick=createSingleFlightTask(async()=>{try{const result=await runLimitWorker();if(result.scanned||result.riskScanned)console.log("Crypto paper worker cycle",result);}catch(e){console.error("Crypto paper worker cycle failed:",e.message);}});
    await tick(); workerTimer=setInterval(tick,workerIntervalMs); workerTimer.unref?.();
  }
  const shutdown=()=>{if(workerTimer)clearInterval(workerTimer);server.close(()=>process.exit(0));};
  process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
}
// Normalize body-parser failures so malformed or oversized requests never leak Express HTML errors.
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const tooLarge = error?.type === "entity.too.large";
  const malformed = error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body");
  const status = tooLarge ? 413 : malformed ? 400 : 500;
  const message = tooLarge ? "Request body is too large." : malformed ? "Request body must contain valid JSON." : "Request could not be processed.";
  res.set("Cache-Control", "no-store").status(status).json({ error: message });
});

if(require.main===module) start().catch(error=>{console.error("Crypto gateway startup failed:",error.message);process.exit(1);});
module.exports={app,runLimitWorker,createSingleFlightTask,releaseWorkerLeaseSafely,rotateRiskPlanSafely,validateOrderInput,validateRiskPlanInput,isFreshCryptoQuote,getRiskPlanTrigger,makeOrderId,createRateLimiter,isUuid};
