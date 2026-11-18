"use strict";
const express=require("express");
const WebSocket=require("ws");
const protobuf=require("protobufjs");
const admin=require("firebase-admin");
const crypto=require("node:crypto");
const path=require("node:path");
const {gunzipSync}=require("node:zlib");
const {calculatePaperFill}=require("./lib/paper-math");
const {WATCHLIST_NAMES,normalizeWatchlists,mergeWatchlistUpdate}=require("./lib/watchlists");
const {isUuid,makeOrderId,makeOrderFingerprint}=require("./lib/order-idempotency");
const {publicPaperOrder}=require("./lib/paper-order-response");
const {formatSseEvent,formatSseComment}=require("./lib/sse");
const {quoteAgeMs,isFreshQuote}=require("./lib/quote-freshness");
const {normalizeProviderQuote}=require("./lib/provider-quote");
const {validateStreamInstrumentKeys}=require("./lib/stream-subscription");
const {reserveUserStream,releaseUserStream}=require("./lib/stream-registry");
const {acquireStreamLease,renewStreamLease,releaseStreamLease}=require("./lib/stream-lease");
const {writeSseFrame,resumeUpstream}=require("./lib/stream-backpressure");
const {createStreamLifecycle}=require("./lib/stream-lifecycle");
const {sendUpstoxSubscription}=require("./lib/upstox-subscription");
const {decodeFeedResponse}=require("./lib/upstox-feed-decoder");
const {filterFreshMarketFeeds}=require("./lib/market-feed-validation");
const {buildPortfolioValuation}=require("./lib/paper-portfolio-valuation");
const {createLeaseHeartbeat}=require("./lib/lease-heartbeat");
const {isUpstoxTokenUsable}=require("./lib/upstox-token");
const {executeLongOptionBuyTransaction}=require("./lib/derivative-order-transaction");
admin.initializeApp();
const db=admin.firestore();
const app=express();
app.use(express.json({limit:"32kb"}));
const PORT=process.env.PORT||8080;
const ENC_KEY=process.env.UPSTOX_TOKEN_ENCRYPTION_KEY;
const MAX_KEYS=Number(process.env.MAX_INSTRUMENT_KEYS||100);
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
// Bound one-shot provider calls so stalled upstream requests cannot pin a Cloud Run request indefinitely.
function fetchProvider(url,options={},timeoutMs=15000){
  return fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});
}
function errorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.name==="TimeoutError"||error?.name==="AbortError")return 504;
  return 500;
}
app.use((req,res,next)=>{
  const origin=req.get("origin");
  if(origin&&ALLOWED_ORIGINS.includes(origin)){
    res.set("Access-Control-Allow-Origin",origin);
    res.set("Vary","Origin");
    res.set("Access-Control-Allow-Headers","Authorization, Content-Type, Accept");
    res.set("Access-Control-Allow-Methods","GET, POST, PUT, OPTIONS");
  }
  if(req.method==="OPTIONS")return res.sendStatus(origin&&ALLOWED_ORIGINS.includes(origin)?204:403);
  next();
});
const INSTRUMENTS_URL="https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz";
let FeedResponse;
let instrumentCache=[];
let instrumentCacheUpdatedAt=0;
const activeUserStreams=new Map();
async function refreshInstrumentCache(){
  const response=await fetchProvider(INSTRUMENTS_URL,{headers:{Accept:"application/gzip"}});
  if(!response.ok) throw new Error("Upstox instrument master download failed: "+response.status);
  const compressed=Buffer.from(await response.arrayBuffer());
  const parsed=JSON.parse(gunzipSync(compressed).toString("utf8"));
  if(!Array.isArray(parsed)||!parsed.length||!parsed.every(x=>x&&typeof x.instrument_key==="string"&&typeof x.segment==="string")) throw new Error("Unexpected Upstox instrument master format");
  instrumentCache=parsed;
  instrumentCacheUpdatedAt=Date.now();
  return instrumentCache.length;
}
async function loadProto(){
  const root=await protobuf.load(path.join(__dirname,"proto","MarketDataFeedV3.proto"));
  FeedResponse=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
}
function decryptToken(box){
  const key=Buffer.from(ENC_KEY||"","base64");
  if(key.length!==32||box?.v!==1) throw new Error("Token encryption configuration invalid");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(box.iv,"base64"));
  decipher.setAuthTag(Buffer.from(box.tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.data,"base64")),decipher.final()]).toString("utf8");
}
async function authenticate(req){
  const header=req.get("authorization")||"";
  if(!header.startsWith("Bearer ")) throw Object.assign(new Error("Sign in required"),{status:401});
  return admin.auth().verifyIdToken(header.slice(7));
}
app.get("/health",(_req,res)=>res.json({
  ok:true,service:"zenura-indian-market-gateway",feedProtocol:"upstox-v3",
  instrumentMasterLoaded:instrumentCache.length>0,
  instrumentMasterUpdatedAt:instrumentCacheUpdatedAt||null
}));
app.get("/instruments",async(req,res)=>{
  try{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000) await refreshInstrumentCache();
    const kind=String(req.query.kind||"all").toLowerCase();
    const exchange=String(req.query.exchange||"").toUpperCase();
    const q=String(req.query.q||"").trim().toLowerCase().slice(0,60);
    const limit=Math.min(Math.max(Number.parseInt(req.query.limit||"50",10)||50,1),100);
    const matches=instrumentCache.filter(item=>{
      if(exchange&&item.exchange!==exchange)return false;
      if(kind==="equities"&&!(item.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(item.segment)))return false;
      if(kind==="indices"&&!(item.instrument_type==="INDEX"&&["NSE_INDEX","BSE_INDEX"].includes(item.segment)))return false;
      if(kind==="futures"&&item.instrument_type!=="FUT")return false;
      if(kind==="options"&&!["CE","PE"].includes(item.instrument_type))return false;
      if(q&&!String(item.trading_symbol||"").toLowerCase().includes(q)&&!String(item.name||"").toLowerCase().includes(q)&&!String(item.underlying_symbol||"").toLowerCase().includes(q))return false;
      return true;
    }).slice(0,limit).map(item=>({
      instrument_key:item.instrument_key,segment:item.segment,exchange:item.exchange,
      name:item.name,trading_symbol:item.trading_symbol,instrument_type:item.instrument_type,
      expiry:item.expiry??null,strike_price:item.strike_price??null,
      lot_size:item.lot_size??null,tick_size:item.tick_size??null,
      underlying_symbol:item.underlying_symbol??null
    }));
    res.set("Cache-Control","public, max-age=60");
    res.json({source:"Upstox BOD instrument master",updatedAt:instrumentCacheUpdatedAt,count:matches.length,results:matches});
  }catch(error){
    console.error("Instrument query failed:",error.message);
    res.status(503).json({error:"Official instrument master is temporarily unavailable."});
  }
});

// Historical OHLC candles — authenticated, token remains server-side.
function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
app.get("/candles",async(req,res)=>{
  try{
    const decoded=await authenticate(req);
    const instrumentKey=String(req.query.instrument_key||"");
    const unit=String(req.query.unit||"");
    const intervalText=String(req.query.interval||"");
    const interval=Number(intervalText);
    const toDate=String(req.query.to_date||"");
    const fromDate=String(req.query.from_date||"");
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))
      return res.status(400).json({error:"A valid instrument_key is required."});
    const validUnit=["minutes","hours","days","weeks","months"].includes(unit);
    const validInterval=Number.isInteger(interval)&&(
      (unit==="minutes"&&interval>=1&&interval<=300)||
      (unit==="hours"&&interval>=1&&interval<=5)||
      (["days","weeks","months"].includes(unit)&&interval===1)
    );
    if(!validUnit||!validInterval)return res.status(400).json({error:"Unsupported candle unit or interval."});
    if(!validDate(toDate)|| (fromDate&&!validDate(fromDate)))
      return res.status(400).json({error:"Dates must use YYYY-MM-DD format."});
    if(fromDate&&fromDate>toDate)return res.status(400).json({error:"from_date must not be after to_date."});
    const from=fromDate?new Date(fromDate+"T00:00:00Z"):null;
    const to=new Date(toDate+"T00:00:00Z");
    if(from){
      const days=(to-from)/86400000;
      const maxDays=unit==="minutes"?(interval<=15?31:92):unit==="hours"?92:unit==="days"?3653:unit==="weeks"?Infinity:Infinity;
      if(days>maxDays)return res.status(400).json({error:"Requested date range exceeds the documented historical retrieval window for this interval."});
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    if(!instrumentCache.some(item=>item.instrument_key===instrumentKey))
      return res.status(400).json({error:"Instrument key is not present in the current official instrument master."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(!isUpstoxTokenUsable(data))
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const encodedKey=encodeURIComponent(instrumentKey);
    const pathParts=[encodedKey,unit,String(interval),encodeURIComponent(toDate)];
    if(fromDate)pathParts.push(encodeURIComponent(fromDate));
    const providerUrl="https://api.upstox.com/v3/historical-candle/"+pathParts.join("/");
    const upstream=await fetchProvider(providerUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const payload=await upstream.json().catch(()=>null);
    if(!upstream.ok){
      console.warn("Historical candle provider returned",upstream.status);
      return res.status(upstream.status===401?403:502).json({error:"Upstox historical candle request failed.",providerStatus:upstream.status});
    }
    res.set("Cache-Control","private, no-store");
    res.json(payload);
  }catch(error){
    if(!res.headersSent)res.status(errorStatus(error)).json({error:error.status?error.message:"Historical candles could not be loaded."});
  }
});


app.get("/option-chain",async(req,res)=>{
  try{
    const decoded=await authenticate(req);
    const instrumentKey=String(req.query.instrument_key||"");
    const expiry=String(req.query.expiry_date||"");
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))
      return res.status(400).json({error:"A valid underlying instrument_key is required."});
    const relative=["current_week","next_week","far_week","current_month","next_month","far_month"];
    if(!relative.includes(expiry)&&!validDate(expiry))
      return res.status(400).json({error:"expiry_date must be YYYY-MM-DD or a supported expiry keyword."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const underlying=instrumentCache.find(item=>item.instrument_key===instrumentKey);
    if(!underlying||!["NSE_INDEX","BSE_INDEX","NSE_EQ","BSE_EQ"].includes(underlying.segment))
      return res.status(400).json({error:"Select a verified NSE/BSE equity or index underlying."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(!isUpstoxTokenUsable(data))
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const params=new URLSearchParams({instrument_key:instrumentKey,expiry_date:expiry});
    const upstream=await fetchProvider("https://api.upstox.com/v2/option/chain?"+params.toString(),{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const payload=await upstream.json().catch(()=>null);
    if(!upstream.ok){
      console.warn("Option chain provider returned",upstream.status);
      return res.status(upstream.status===401?403:502).json({error:"Upstox option-chain request failed.",providerStatus:upstream.status});
    }
    res.set("Cache-Control","private, no-store");
    res.json(payload);
  }catch(error){
    if(!res.headersSent)res.status(errorStatus(error)).json({error:error.status?error.message:"Option chain could not be loaded."});
  }
});


function paperStartingCashPaise(){
  const value=Number(process.env.INDIAN_PAPER_STARTING_CASH_PAISE||"");
  return Number.isSafeInteger(value)&&value>0?value:null;
}
function paperAccountRef(uid){return db.collection("indianPaperAccounts").doc(uid);}
app.get("/paper/account",async(req,res)=>{
  try{
    const decoded=await authenticate(req),startingCash=paperStartingCashPaise();
    if(!startingCash)return res.status(503).json({error:"Indian paper-trading starting balance is not configured by the administrator."});
    const ref=paperAccountRef(decoded.uid);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists)tx.create(ref,{currency:"INR",startingCashPaise:startingCash,cashPaise:startingCash,positions:{},derivativePositions:{},reservedMarginPaise:0,realizedPnlPaise:0,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),version:1});else if(snap.data().derivativePositions===undefined)tx.update(ref,{derivativePositions:{},reservedMarginPaise:0,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    const snap=await ref.get(),data=snap.data();
    res.set("Cache-Control","private, no-store");
    res.json({currency:"INR",startingCashPaise:data.startingCashPaise,cashPaise:data.cashPaise,positions:data.positions||{},derivativePositions:data.derivativePositions||{},reservedMarginPaise:data.reservedMarginPaise||0,realizedPnlPaise:data.realizedPnlPaise||0,updatedAt:data.updatedAt?.toMillis?.()||null,simulationOnly:true});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Paper account could not be loaded."});}
});
app.post("/paper/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req);
    const instrumentKey=typeof req.body?.instrument_key==="string"?req.body.instrument_key:"";
    const side=String(req.body?.side||"").toUpperCase();
    const quantity=Number(req.body?.quantity);
    const idempotencyKey=typeof req.body?.idempotency_key==="string"?req.body.idempotency_key:"";
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))return res.status(400).json({error:"A valid instrument_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Only BUY and SELL paper orders are supported."});
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return res.status(400).json({error:"Quantity must be a whole number between 1 and 1,000,000."});
    const orderId=makeOrderId(decoded.uid,idempotencyKey),requestFingerprint=makeOrderFingerprint({instrumentKey,side,quantity});
    const orderRef=db.collection("indianPaperOrders").doc(orderId);
    const priorOrder=await orderRef.get();
    if(priorOrder.exists){
      const prior=priorOrder.data();assertIdempotentReplay(prior,requestFingerprint);
      const currentAccount=await paperAccountRef(decoded.uid).get(),current=currentAccount.exists?currentAccount.data():{};
      res.set("Cache-Control","private, no-store");
      return res.status(200).json(publicPaperOrder(prior,{orderId:orderRef.id,cashPaise:current.cashPaise,realizedPnlTotalPaise:current.realizedPnlPaise,idempotentReplay:true}));
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Phase 1 paper orders support verified NSE/BSE cash equities only."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Connect your Upstox account before placing a paper order."});
    const connectionData=connection.data();
    if(!isUpstoxTokenUsable(connectionData))return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:instrumentKey});
    const quoteResponse=await fetchProvider(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const quotePayload=await quoteResponse.json().catch(()=>null);
    if(!quoteResponse.ok)return res.status(502).json({error:"A current Upstox full quote could not be verified.",providerStatus:quoteResponse.status});
    const quoteEntry=Object.values(quotePayload?.data||{}).find(x=>x&&x.instrument_token===instrumentKey);
    let normalizedQuote;
    try{normalizedQuote=normalizeProviderQuote(quoteEntry,instrumentKey);}
    catch(error){return res.status(error.status||409).json({error:error.message,quoteAgeMs:Number.isFinite(error.quoteAgeMs)?error.quoteAgeMs:null});}
    const {pricePaise,tradeTimeMs,quoteAgeMs:quoteAge}=normalizedQuote;
    const grossPaise=pricePaise*quantity;
    if(!Number.isSafeInteger(grossPaise)||grossPaise<=0)return res.status(400).json({error:"Order value exceeds supported calculation limits."});
    const accountRef=paperAccountRef(decoded.uid);
    const {executePaperOrderTransaction}=require("./lib/paper-order-transaction");
    const result=await executePaperOrderTransaction({
      db,accountRef,orderRef,uid:decoded.uid,requestFingerprint,
      order:{uid:decoded.uid,requestFingerprint,instrumentKey,tradingSymbol:instrument.trading_symbol||instrument.name,exchange:instrument.exchange,side,quantity,executionPricePaise:pricePaise,quoteTimestampMs:tradeTimeMs,quoteAgeMs:quoteAge,orderType:"MARKET",status:"FILLED",simulationOnly:true},
      pricePaise,publicPaperOrder,serverTimestamp:()=>admin.firestore.FieldValue.serverTimestamp()
    });
    res.set("Cache-Control","private, no-store");
    res.status(result.idempotentReplay?200:201).json(result);
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Paper order could not be completed."});}
});

app.post("/paper/derivative/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req);
    const instrumentKey=typeof req.body?.instrument_key==="string"?req.body.instrument_key:"";
    const lots=Number(req.body?.lots);
    const side=String(req.body?.side||"").toUpperCase();
    const idempotencyKey=typeof req.body?.idempotency_key==="string"?req.body.idempotency_key:"";
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!instrumentKey||instrumentKey.length>100||/[\\r\\n]/.test(instrumentKey))return res.status(400).json({error:"A valid instrument_key is required."});
    if(side!=="BUY")return res.status(400).json({error:"This phase enables long CE/PE BUY only. Short options and futures remain disabled until margin lifecycle integration is complete."});
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000)return res.status(400).json({error:"Lots must be a whole number between 1 and 10,000."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&["CE","PE"].includes(x.instrument_type)&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE CE/PE option contract from the official instrument master."});
    const accountRef=paperAccountRef(decoded.uid),accountSnap=await accountRef.get();
    if(!accountSnap.exists)return res.status(409).json({error:"Initialize your shared Indian paper account before placing a derivative order."});
    const account=accountSnap.data();
    if(!Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||!Number.isSafeInteger(account.version)||account.version<1)
      return res.status(409).json({error:"Shared paper account balance is invalid; derivative order rejected."});
    const quantity=lots*instrument.lot_size;
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return res.status(400).json({error:"Contract quantity exceeds supported limits."});
    const orderId=makeOrderId(decoded.uid,idempotencyKey);
    const orderRef=db.collection("indianDerivativeOrders").doc(orderId);
    const requestFingerprint=makeOrderFingerprint({instrumentKey,side:"BUY",quantity});
    const priorOrder=await orderRef.get();
    if(priorOrder.exists){
      const prior=priorOrder.data();
      assertIdempotentReplay(prior,requestFingerprint);
      const current=await accountRef.get(),currentData=current.exists?current.data():{};
      res.set("Cache-Control","private, no-store");
      return res.status(200).json({
        orderId,tradingSymbol:prior.tradingSymbol,side:prior.side,quantity:prior.quantity,
        lots:prior.lots,executionPricePaise:prior.executionPricePaise,grossPaise:prior.grossPaise,
        cashPaise:currentData.cashPaise,realizedPnlPaise:currentData.realizedPnlPaise||0,
        idempotentReplay:true,simulationOnly:true,excludesCharges:true
      });
    }
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Connect your Upstox account before placing a derivative paper order."});
    const connectionData=connection.data();
    if(!isUpstoxTokenUsable(connectionData))return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:instrumentKey});
    const quoteResponse=await fetchProvider(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const quotePayload=await quoteResponse.json().catch(()=>null);
    if(!quoteResponse.ok)return res.status(502).json({error:"A current Upstox full quote could not be verified for this option.",providerStatus:quoteResponse.status});
    const quoteEntry=Object.values(quotePayload?.data||{}).find(x=>x&&x.instrument_token===instrumentKey);
    let normalizedQuote;
    try{normalizedQuote=normalizeProviderQuote(quoteEntry,instrumentKey);}
    catch(error){return res.status(error.status||409).json({error:error.message,quoteAgeMs:Number.isFinite(error.quoteAgeMs)?error.quoteAgeMs:null});}
    const result=await executeLongOptionBuyTransaction({
      db,accountRef,orderRef,uid:decoded.uid,idempotencyKey,instrument,lots,
      quote:{instrumentKey,pricePaise:normalizedQuote.pricePaise,observedAtMs:normalizedQuote.tradeTimeMs},
      serverTimestamp:()=>admin.firestore.FieldValue.serverTimestamp()
    });
    res.set("Cache-Control","private, no-store");
    res.status(result.idempotentReplay?200:201).json({
      orderId:result.orderId,tradingSymbol:result.order.tradingSymbol,side:result.order.side,
      quantity:result.order.quantity,lots:result.order.lots,executionPricePaise:result.order.executionPricePaise,
      grossPaise:result.order.grossPaise,cashPaise:result.cashPaise,
      realizedPnlPaise:result.realizedPnlPaise,idempotentReplay:result.idempotentReplay,
      simulationOnly:true,excludesCharges:true
    });
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Derivative paper order could not be completed."});}
});

app.get("/paper/portfolio",async(req,res)=>{
  try{
    const decoded=await authenticate(req),accountSnap=await paperAccountRef(decoded.uid).get();
    if(!accountSnap.exists)return res.status(404).json({error:"Indian paper account has not been initialized."});
    const account=accountSnap.data(),allPositions=Object.entries(account.positions||{});
    if(!Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||!Number.isSafeInteger(account.realizedPnlPaise??0))return res.status(409).json({error:"Paper account contains invalid balance data."});
    if(allPositions.some(([,p])=>!p||!Number.isSafeInteger(p.quantity)||p.quantity<0||p.quantity>1000000||!Number.isSafeInteger(p.averagePricePaise)||p.averagePricePaise<0||(p.quantity>0&&p.averagePricePaise<1)))return res.status(409).json({error:"Paper portfolio contains an invalid position; valuation stopped to protect account totals."});
    const positions=allPositions.filter(([,p])=>p.quantity>0);
    if(positions.length>50)return res.status(409).json({error:"Portfolio contains more than 50 open positions; contact support before refreshing valuation."});
    if(!positions.length){
      res.set("Cache-Control","private, no-store");
      return res.json({positions:[],cashPaise:account.cashPaise,marketValuePaise:0,unrealizedPnlPaise:0,equityPaise:account.cashPaise,realizedPnlPaise:account.realizedPnlPaise||0,valuationStatus:"no_open_positions"});
    }
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const connectionData=connection.data();
    if(!isUpstoxTokenUsable(connectionData))return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext),keys=positions.map(([key])=>key);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
    const quoteResponse=await fetchProvider(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const quotePayload=await quoteResponse.json().catch(()=>null);
    if(!quoteResponse.ok)return res.status(502).json({error:"Portfolio market valuation could not be retrieved.",providerStatus:quoteResponse.status});
    const quotes=Object.values(quotePayload?.data||{});
    const valuation=buildPortfolioValuation({positions,quotes,cashPaise:account.cashPaise,realizedPnlPaise:account.realizedPnlPaise??0,instruments:instrumentCache,now:Date.now(),maxAgeMs:60000});
    res.set("Cache-Control","private, no-store");
    res.json(valuation);
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Portfolio valuation could not be loaded."});}
});

app.get("/paper/derivatives/portfolio",async(req,res)=>{
  try{
    const decoded=await authenticate(req),accountSnap=await paperAccountRef(decoded.uid).get();
    if(!accountSnap.exists)return res.status(404).json({error:"Indian paper account has not been initialized."});
    const account=accountSnap.data(),raw=account.derivativePositions||{};
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return res.status(409).json({error:"Derivative position storage is invalid."});
    const positions=Object.entries(raw).filter(([,p])=>p&&p.netQuantity!==0).map(([instrumentKey,p])=>({
      instrumentKey,instrumentType:p.instrumentType,netQuantity:p.netQuantity,
      averagePricePaise:p.averagePricePaise
    }));
    if(positions.length>50)return res.status(409).json({error:"More than 50 open derivative positions; valuation stopped."});
    if(!positions.length){
      res.set("Cache-Control","private, no-store");
      return res.json({positions:[],cashPaise:account.cashPaise,marketValuePaise:0,unrealizedPnlPaise:0,reservedMarginPaise:0,realizedPnlPaise:account.realizedPnlPaise||0,valuationStatus:"no_open_positions",simulationOnly:true,excludesCharges:true});
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    for(const p of positions){
      const verified=instrumentCache.find(x=>x.instrument_key===p.instrumentKey&&x.instrument_type===p.instrumentType&&["CE","PE"].includes(x.instrument_type)&&["NSE_FO","BSE_FO"].includes(x.segment));
      if(!verified)return res.status(409).json({error:"An open derivative position is not present in the current official instrument master."});
    }
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const connectionData=connection.data();
    if(!isUpstoxTokenUsable(connectionData))return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:positions.map(p=>p.instrumentKey).join(",")});
    const upstream=await fetchProvider(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const payload=await upstream.json().catch(()=>null);
    if(!upstream.ok)return res.status(502).json({error:"Derivative portfolio quotes could not be retrieved.",providerStatus:upstream.status});
    const quoteEntries=Object.values(payload?.data||{}),quotes=[];
    for(const p of positions){
      const entry=quoteEntries.find(x=>x?.instrument_token===p.instrumentKey);
      const normalized=normalizeProviderQuote(entry,p.instrumentKey,{maxAgeMs:15000});
      quotes.push({instrumentKey:p.instrumentKey,pricePaise:normalized.pricePaise,observedAtMs:normalized.tradeTimeMs});
    }
    const {calculateDerivativePortfolio}=require("./lib/derivative-portfolio");
    const valuation=calculateDerivativePortfolio({positions,quotes,now:Date.now()});
    res.set("Cache-Control","private, no-store");
    res.json({...valuation,cashPaise:account.cashPaise,realizedPnlPaise:account.realizedPnlPaise||0,simulationOnly:true,excludesCharges:true});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Derivative portfolio valuation could not be loaded."});}
});

app.get("/paper/derivative/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req),rawLimit=req.query.limit===undefined?"50":String(req.query.limit);
    if(!/^\d+$/.test(rawLimit)||Number(rawLimit)<1)return res.status(400).json({error:"Derivative order history limit must be a whole number from 1 to 100."});
    const limit=Math.min(Number(rawLimit),100);
    const snap=await db.collection("indianDerivativeOrders").where("uid","==",decoded.uid).orderBy("createdAt","desc").limit(limit).get();
    const orders=snap.docs.map(doc=>{const o=doc.data();return {id:doc.id,tradingSymbol:o.tradingSymbol,instrumentKey:o.instrumentKey,instrumentType:o.instrumentType,expiry:o.expiry,side:o.side,quantity:o.quantity,lots:o.lots,executionPricePaise:o.executionPricePaise,grossPaise:o.grossPaise,status:o.status,orderType:o.orderType,simulationOnly:true,createdAt:o.createdAt?.toMillis?.()||null};});
    res.set("Cache-Control","private, no-store");
    res.json({orders,simulationOnly:true,excludesCharges:true});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Derivative order history could not be loaded."});}
});

app.get("/paper/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req),rawLimit=req.query.limit===undefined?"50":String(req.query.limit);
    if(!/^\d+$/.test(rawLimit)||Number(rawLimit)<1)return res.status(400).json({error:"Order history limit must be a whole number from 1 to 100."});
    const limit=Math.min(Number(rawLimit),100),cursor=typeof req.query.cursor==="string"?req.query.cursor:"";
    if(cursor&&!/^[a-f0-9]{64}$/.test(cursor))return res.status(400).json({error:"Invalid order history cursor."});
    const collection=db.collection("indianPaperOrders");
    let query=collection.where("uid","==",decoded.uid).orderBy("createdAt","desc");
    if(cursor){
      const cursorSnap=await collection.doc(cursor).get();
      if(!cursorSnap.exists||cursorSnap.data()?.uid!==decoded.uid)return res.status(400).json({error:"Order history cursor is invalid."});
      query=query.startAfter(cursorSnap);
    }
    const snap=await query.limit(limit+1).get(),hasMore=snap.docs.length>limit,docs=snap.docs.slice(0,limit);
    const orders=docs.map(doc=>{const order=doc.data();return {id:doc.id,tradingSymbol:order.tradingSymbol,exchange:order.exchange,side:order.side,quantity:order.quantity,executionPricePaise:order.executionPricePaise,grossPaise:order.grossPaise,realizedPnlPaise:order.realizedPnlPaise,orderType:order.orderType,status:order.status,simulationOnly:order.simulationOnly,createdAt:order.createdAt?.toMillis?.()||null};});
    res.set("Cache-Control","private, no-store");
    res.json({orders,hasMore,nextCursor:hasMore?docs[docs.length-1].id:null,simulationOnly:true});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Paper order history could not be loaded."});}
});

// Per-user named Indian-market watchlists. Legacy data is normalized by the tested helper.
function requestedWatchlist(req){
  const name=String(req.query?.name||req.body?.name||"My Stocks");
  if(!WATCHLIST_NAMES.includes(name)){const error=new Error("Choose a valid watchlist name.");error.status=400;throw error;}
  return name;
}
app.get("/watchlists",async(req,res)=>{
  try{
    const decoded=await authenticate(req),snap=await db.collection("indianMarketWatchlists").doc(decoded.uid).get(),data=snap.exists?snap.data():{};
    const watchlists=normalizeWatchlists(data);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const result={};
    for(const name of WATCHLIST_NAMES)result[name]=watchlists[name].map(key=>instrumentCache.find(x=>x.instrument_key===key)).filter(Boolean).map(x=>({instrument_key:x.instrument_key,segment:x.segment,exchange:x.exchange,trading_symbol:x.trading_symbol,name:x.name,instrument_type:x.instrument_type,expiry:x.expiry??null}));
    res.set("Cache-Control","private, no-store");
    res.json({watchlists:result,names:WATCHLIST_NAMES,updatedAt:data.updatedAt?.toMillis?.()||null,maxItemsPerList:50});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Watchlists could not be loaded."});}
});
app.get("/watchlist",async(req,res)=>{
  try{
    const decoded=await authenticate(req),snap=await db.collection("indianMarketWatchlists").doc(decoded.uid).get(),data=snap.exists?snap.data():{},name=requestedWatchlist(req),keys=normalizeWatchlists(data)[name];
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const items=keys.map(key=>instrumentCache.find(x=>x.instrument_key===key)).filter(Boolean).map(x=>({instrument_key:x.instrument_key,segment:x.segment,exchange:x.exchange,trading_symbol:x.trading_symbol,name:x.name,instrument_type:x.instrument_type,expiry:x.expiry??null}));
    res.set("Cache-Control","private, no-store");res.json({name,items,updatedAt:data.updatedAt?.toMillis?.()||null,maxItems:50});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Watchlist could not be loaded."});}
});
app.get("/watchlist/quotes",async(req,res)=>{
  try{
    const decoded=await authenticate(req),name=requestedWatchlist(req),snap=await db.collection("indianMarketWatchlists").doc(decoded.uid).get(),keys=normalizeWatchlists(snap.exists?snap.data():{})[name];
    if(!keys.length){res.set("Cache-Control","private, no-store");return res.json({name,quotes:[],status:"empty"});}
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(!isUpstoxTokenUsable(data))return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext),quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
    const upstream=await fetchProvider(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}}),payload=await upstream.json().catch(()=>null);
    if(!upstream.ok)return res.status(502).json({error:"Watchlist quotes could not be retrieved.",providerStatus:upstream.status});
    const byKey=new Map(Object.values(payload?.data||{}).filter(q=>q&&typeof q.instrument_token==="string").map(q=>[q.instrument_token,q])),now=Date.now();
    const quotes=keys.map(instrumentKey=>{
      const q=byKey.get(instrumentKey),last=Number(q?.last_price),change=Number(q?.net_change),tradeTime=Number(q?.last_trade_time||0),age=quoteAgeMs(tradeTime,now);
      const fresh=Number.isFinite(last)&&last>0&&isFreshQuote(tradeTime,60000,now),previous=last-change,percent=Number.isFinite(change)&&previous>0?(change/previous)*100:null,instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey);
      return {instrumentKey,tradingSymbol:instrument?.trading_symbol||q?.symbol||instrumentKey,lastPrice:fresh?last:null,netChange:fresh&&Number.isFinite(change)?change:null,changePercent:fresh&&Number.isFinite(percent)?percent:null,quoteAgeMs:Number.isFinite(age)?age:null,status:fresh?"fresh":"stale_or_unavailable"};
    });
    res.set("Cache-Control","private, no-store");res.json({name,quotes,asOf:now,status:quotes.every(q=>q.status==="fresh")?"fresh":"partial_stale"});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Watchlist quotes could not be loaded."});}
});
app.put("/watchlist",async(req,res)=>{
  try{
    const decoded=await authenticate(req),name=requestedWatchlist(req),raw=req.body?.instrumentKeys;
    let keys;
    try{mergeWatchlistUpdate({},name,raw);keys=[...new Set(raw)];}catch(error){return res.status(error.status||400).json({error:error.message});}
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const valid=new Set(instrumentCache.map(x=>x.instrument_key));
    if(keys.some(key=>!valid.has(key)))return res.status(400).json({error:"Watchlist contains an instrument not present in the official instrument master."});
    const ref=db.collection("indianMarketWatchlists").doc(decoded.uid);
    await db.runTransaction(async tx=>{const snap=await tx.get(ref),data=snap.exists?snap.data():{},watchlists=mergeWatchlistUpdate(data,name,keys);tx.set(ref,{uid:decoded.uid,watchlists,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});});
    res.set("Cache-Control","private, no-store");res.json({saved:true,name,count:keys.length,maxItems:50});
  }catch(error){res.status(errorStatus(error)).json({error:error.status?error.message:"Watchlist could not be saved."});}
});

app.post("/stream",async(req,res)=>{
  let upstream;
  let leaseHeartbeat;
  let streamUid=null;
  let streamReservation=null;
  let streamLeaseId=null;
  let streamLeaseAcquired=false;
  const lifecycle=createStreamLifecycle(()=>{
    if(leaseHeartbeat)leaseHeartbeat.stop();
    res.removeListener("drain",onDrain);
    if(streamUid&&streamReservation)releaseUserStream(activeUserStreams,streamUid,streamReservation);
    if(streamLeaseAcquired&&streamUid&&streamLeaseId)releaseStreamLease(db,streamUid,streamLeaseId).catch(()=>{});
    if(upstream&&upstream.readyState<WebSocket.CLOSING)upstream.close();
  });
  const onDrain=()=>resumeUpstream(upstream,lifecycle.closed);
  const writeEvent=(event,payload)=>{
    if(lifecycle.closed||res.destroyed||res.writableEnded)return false;
    try{return writeSseFrame(res,upstream,formatSseEvent(event,payload));}
    catch(error){
      if(error.status!==413)throw error;
      writeSseFrame(res,upstream,formatSseEvent("error",{message:"Market feed frame exceeded the safe size limit. Stream closed."}));
      stop();
      if(!res.destroyed&&!res.writableEnded)res.end();
      return false;
    }
  };
  const stop=()=>lifecycle.stop();
  res.on("close",stop);
  try{
    const decoded=await authenticate(req);
    if(lifecycle.closed||res.destroyed||res.writableEnded)return;
    streamUid=decoded.uid;
    streamReservation=reserveUserStream(activeUserStreams,streamUid);
    if(!streamReservation)return res.status(429).json({error:"A live market stream is already active for this account. Close it before reconnecting."});
    streamLeaseId=crypto.randomUUID();
    streamLeaseAcquired=await acquireStreamLease(db,streamUid,streamLeaseId);
    if(!streamLeaseAcquired)return res.status(429).json({error:"A live market stream is already active for this account. Close it before reconnecting."});
    leaseHeartbeat=createLeaseHeartbeat({
      renew:()=>renewStreamLease(db,streamUid,streamLeaseId),
      onRenewed:()=>{if(res.headersSent&&!lifecycle.closed&&!res.destroyed&&!res.writableEnded)writeSseFrame(res,upstream,formatSseComment("keep-alive"));},
      onLost:()=>{if(res.headersSent){writeEvent("error",{message:"Live market stream lease expired. Reconnect to continue."});if(!res.destroyed&&!res.writableEnded)res.end();}else if(!res.destroyed&&!res.writableEnded)res.status(429).json({error:"Live market stream lease expired during startup. Reconnect to continue."});stop();},
      onError:()=>{if(res.headersSent){writeEvent("error",{message:"Live market stream lease could not be renewed."});if(!res.destroyed&&!res.writableEnded)res.end();}else if(!res.destroyed&&!res.writableEnded)res.status(503).json({error:"Live market stream lease could not be renewed."});stop();}
    });
    if(lifecycle.closed||res.destroyed||res.writableEnded){stop();return;}
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    let keys;
    try{keys=validateStreamInstrumentKeys(req.body?.instrumentKeys,instrumentCache.map(item=>item.instrument_key),MAX_KEYS);}
    catch(error){return res.status(error.status||400).json({error:error.message});}
    const mode=req.body?.mode||"ltpc";
    if(!["ltpc","full","option_greeks"].includes(mode)) return res.status(400).json({error:"Unsupported feed mode."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists) return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(!isUpstoxTokenUsable(data))
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const authResponse=await fetchProvider("https://api.upstox.com/v3/feed/market-data-feed/authorize",{
      headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}
    });
    const authData=await authResponse.json().catch(()=>({}));
    if(!authResponse.ok||!authData.data?.authorized_redirect_uri)
      return res.status(502).json({error:"Upstox could not authorize the live market feed."});
    if(res.destroyed||res.writableEnded)return;
    res.status(200);
    res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.on("drain",onDrain);
    res.flushHeaders?.();
    writeEvent("status",{connected:false,connecting:true,mode,keys:keys.length});
    upstream=new WebSocket(authData.data.authorized_redirect_uri,{
      followRedirects:true,handshakeTimeout:15000,
      headers:{Authorization:"Bearer "+accessToken,Accept:"*/*"}
    });
    upstream.on("open",()=>{
      if(lifecycle.closed||res.destroyed||res.writableEnded){stop();return;}
      writeEvent("status",{connected:true,mode,keys:keys.length});
      sendUpstoxSubscription(upstream,{mode,instrumentKeys:keys}).catch(error=>{
        if(error){writeEvent("error",{message:"Market feed subscription could not be sent"});stop();if(!res.writableEnded)res.end();}
      });
    });
    upstream.on("message",(bytes,isBinary)=>{
      if(lifecycle.closed||res.destroyed||res.writableEnded)return;
      if(!isBinary){writeEvent("upstream",{message:String(bytes).slice(0,500)});return;}
      try{
        const decoded=decodeFeedResponse(FeedResponse,bytes);
        const validated=filterFreshMarketFeeds(decoded,keys);
        if(validated)writeEvent("market",validated);
      }catch(error){
        writeEvent("error",{message:"Market feed decode failed"});
      }
    });
    upstream.on("error",()=>{
      writeEvent("error",{message:"Upstream market feed connection failed"});
      stop();
      if(!res.destroyed&&!res.writableEnded)res.end();
    });
    upstream.on("close",()=>{
      if(!lifecycle.closed){
        writeEvent("status",{connected:false});
        stop();
        if(!res.destroyed&&!res.writableEnded)res.end();
      }
    });
  }catch(error){
    if(!res.headersSent)res.status(errorStatus(error)).json({error:error.status?error.message:"Market feed could not be started."});
    else{writeEvent("error",{message:"Market feed stopped unexpectedly"});if(!res.writableEnded)res.end();}
    stop();
  }
});
loadProto().then(()=>{
  app.listen(PORT,"0.0.0.0",()=>console.log("Indian market gateway listening on",PORT));
  refreshInstrumentCache().catch(error=>console.error("Initial instrument refresh failed:",error.message));
}).catch(error=>{console.error("Proto load failed",error);process.exit(1);});
