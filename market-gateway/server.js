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
admin.initializeApp();
const db=admin.firestore();
const app=express();
app.use(express.json({limit:"32kb"}));
const PORT=process.env.PORT||8080;
const ENC_KEY=process.env.UPSTOX_TOKEN_ENCRYPTION_KEY;
const MAX_KEYS=Number(process.env.MAX_INSTRUMENT_KEYS||100);
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
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
async function refreshInstrumentCache(){
  const response=await fetch(INSTRUMENTS_URL,{headers:{Accept:"application/gzip"}});
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
    if(data.status!=="connected"||!data.expiresAt||data.expiresAt.toMillis()<=Date.now())
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const encodedKey=encodeURIComponent(instrumentKey);
    const pathParts=[encodedKey,unit,String(interval),encodeURIComponent(toDate)];
    if(fromDate)pathParts.push(encodeURIComponent(fromDate));
    const providerUrl="https://api.upstox.com/v3/historical-candle/"+pathParts.join("/");
    const upstream=await fetch(providerUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const payload=await upstream.json().catch(()=>null);
    if(!upstream.ok){
      console.warn("Historical candle provider returned",upstream.status);
      return res.status(upstream.status===401?403:502).json({error:"Upstox historical candle request failed.",providerStatus:upstream.status});
    }
    res.set("Cache-Control","private, no-store");
    res.json(payload);
  }catch(error){
    if(!res.headersSent)res.status(error.status||500).json({error:error.status?error.message:"Historical candles could not be loaded."});
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
    if(data.status!=="connected"||!data.expiresAt||data.expiresAt.toMillis()<=Date.now())
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const params=new URLSearchParams({instrument_key:instrumentKey,expiry_date:expiry});
    const upstream=await fetch("https://api.upstox.com/v2/option/chain?"+params.toString(),{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const payload=await upstream.json().catch(()=>null);
    if(!upstream.ok){
      console.warn("Option chain provider returned",upstream.status);
      return res.status(upstream.status===401?403:502).json({error:"Upstox option-chain request failed.",providerStatus:upstream.status});
    }
    res.set("Cache-Control","private, no-store");
    res.json(payload);
  }catch(error){
    if(!res.headersSent)res.status(error.status||500).json({error:error.status?error.message:"Option chain could not be loaded."});
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
      if(!snap.exists)tx.create(ref,{currency:"INR",startingCashPaise:startingCash,cashPaise:startingCash,positions:{},realizedPnlPaise:0,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),version:1});
    });
    const snap=await ref.get(),data=snap.data();
    res.set("Cache-Control","private, no-store");
    res.json({currency:"INR",startingCashPaise:data.startingCashPaise,cashPaise:data.cashPaise,positions:data.positions||{},realizedPnlPaise:data.realizedPnlPaise||0,updatedAt:data.updatedAt?.toMillis?.()||null,simulationOnly:true});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Paper account could not be loaded."});}
});
app.post("/paper/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req);
    const instrumentKey=typeof req.body?.instrument_key==="string"?req.body.instrument_key:"";
    const side=String(req.body?.side||"").toUpperCase();
    const quantity=Number(req.body?.quantity);
    const idempotencyKey=typeof req.body?.idempotency_key==="string"?req.body.idempotency_key:"";
    if(!/^[0-9a-f-]{36}$/i.test(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))return res.status(400).json({error:"A valid instrument_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Only BUY and SELL paper orders are supported."});
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return res.status(400).json({error:"Quantity must be a whole number between 1 and 1,000,000."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Phase 1 paper orders support verified NSE/BSE cash equities only."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Connect your Upstox account before placing a paper order."});
    const connectionData=connection.data();
    if(connectionData.status!=="connected"||!connectionData.expiresAt||connectionData.expiresAt.toMillis()<=Date.now())return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:instrumentKey});
    const quoteResponse=await fetch(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const quotePayload=await quoteResponse.json().catch(()=>null);
    if(!quoteResponse.ok)return res.status(502).json({error:"A current Upstox full quote could not be verified.",providerStatus:quoteResponse.status});
    const quoteEntry=Object.values(quotePayload?.data||{}).find(x=>x&&x.instrument_token===instrumentKey);
    const ltp=Number(quoteEntry?.last_price),tradeTime=Number(quoteEntry?.last_trade_time||0);
    const quoteAge=tradeTime?Date.now()-tradeTime:Infinity;
    if(!Number.isFinite(ltp)||ltp<=0||!Number.isFinite(tradeTime)||quoteAge< -5000||quoteAge>15000)
      return res.status(409).json({error:"No sufficiently fresh provider quote is available. Paper order rejected.",quoteAgeMs:Number.isFinite(quoteAge)?quoteAge:null});
    const pricePaise=Math.round(ltp*100),grossPaise=pricePaise*quantity;
    if(!Number.isSafeInteger(grossPaise)||grossPaise<=0)return res.status(400).json({error:"Order value exceeds supported calculation limits."});
    const accountRef=paperAccountRef(decoded.uid);
    const orderId=crypto.createHash("sha256").update(decoded.uid+":"+idempotencyKey).digest("hex");
    const orderRef=db.collection("indianPaperOrders").doc(orderId);
    let result;
    await db.runTransaction(async tx=>{
      const [accountSnap,existingOrder]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
      if(existingOrder.exists){result={...existingOrder.data(),orderId:orderRef.id,cashPaise:accountSnap.data()?.cashPaise,realizedPnlTotalPaise:accountSnap.data()?.realizedPnlPaise||0,idempotentReplay:true};return;}
      if(!accountSnap.exists)throw Object.assign(new Error("Paper account is not initialized."),{status:409});
      const account=accountSnap.data(),positions={...(account.positions||{})},position={...(positions[instrumentKey]||{quantity:0,averagePricePaise:0})};
      let cash=account.cashPaise,realizedPnlPaise=account.realizedPnlPaise||0,orderRealizedPnlPaise=0;
      const fill=calculatePaperFill({side,quantity,pricePaise,cashPaise:cash,realizedPnlPaise,position});
      cash=fill.cashPaise;realizedPnlPaise=fill.realizedPnlPaise;orderRealizedPnlPaise=fill.orderRealizedPnlPaise;
      if(fill.position.quantity===0)delete positions[instrumentKey];else positions[instrumentKey]=fill.position;
      const order={uid:decoded.uid,instrumentKey,tradingSymbol:instrument.trading_symbol||instrument.name,exchange:instrument.exchange,side,quantity,executionPricePaise:pricePaise,grossPaise:fill.grossPaise,quoteTimestampMs:tradeTime,quoteAgeMs:quoteAge,realizedPnlPaise:orderRealizedPnlPaise,orderType:"MARKET",status:"FILLED",simulationOnly:true,createdAt:admin.firestore.FieldValue.serverTimestamp()};
      tx.create(orderRef,order);
      tx.update(accountRef,{cashPaise:cash,positions,realizedPnlPaise,updatedAt:admin.firestore.FieldValue.serverTimestamp(),version:(account.version||1)+1});
      result={orderId:orderRef.id,...order,cashPaise:cash,realizedPnlTotalPaise:realizedPnlPaise};
    });
    res.set("Cache-Control","private, no-store");
    res.status(result.idempotentReplay?200:201).json(result);
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Paper order could not be completed."});}
});

app.get("/paper/portfolio",async(req,res)=>{
  try{
    const decoded=await authenticate(req),accountSnap=await paperAccountRef(decoded.uid).get();
    if(!accountSnap.exists)return res.status(404).json({error:"Indian paper account has not been initialized."});
    const account=accountSnap.data(),positions=Object.entries(account.positions||{}).filter(([,p])=>p&&Number.isSafeInteger(p.quantity)&&p.quantity>0);
    if(positions.length>50)return res.status(409).json({error:"Portfolio contains more than 50 open positions; contact support before refreshing valuation."});
    if(!positions.length){
      res.set("Cache-Control","private, no-store");
      return res.json({positions:[],cashPaise:account.cashPaise,marketValuePaise:0,unrealizedPnlPaise:0,equityPaise:account.cashPaise,realizedPnlPaise:account.realizedPnlPaise||0,valuationStatus:"no_open_positions"});
    }
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const connectionData=connection.data();
    if(connectionData.status!=="connected"||!connectionData.expiresAt||connectionData.expiresAt.toMillis()<=Date.now())return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(connectionData.tokenCiphertext),keys=positions.map(([key])=>key);
    const quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
    const quoteResponse=await fetch(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
    const quotePayload=await quoteResponse.json().catch(()=>null);
    if(!quoteResponse.ok)return res.status(502).json({error:"Portfolio market valuation could not be retrieved.",providerStatus:quoteResponse.status});
    const quotes=Object.values(quotePayload?.data||{}),now=Date.now(),valued=[];
    let marketValuePaise=0,unrealizedPnlPaise=0,staleCount=0;
    for(const [instrumentKey,position] of positions){
      const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey);
      const quote=quotes.find(x=>x?.instrument_token===instrumentKey);
      const ltp=Number(quote?.last_price),tradeTime=Number(quote?.last_trade_time||0),age=tradeTime?now-tradeTime:Infinity;
      const fresh=Number.isFinite(ltp)&&ltp>0&&Number.isFinite(age)&&age>=-5000&&age<=60000;
      if(!fresh){staleCount++;valued.push({instrumentKey,tradingSymbol:instrument?.trading_symbol||instrumentKey,quantity:position.quantity,averagePricePaise:position.averagePricePaise,lastPricePaise:null,marketValuePaise:null,unrealizedPnlPaise:null,quoteAgeMs:Number.isFinite(age)?age:null,valuationStatus:"stale_or_unavailable"});continue;}
      const lastPricePaise=Math.round(ltp*100),value=lastPricePaise*position.quantity,pnl=(lastPricePaise-position.averagePricePaise)*position.quantity;
      marketValuePaise+=value;unrealizedPnlPaise+=pnl;
      valued.push({instrumentKey,tradingSymbol:instrument?.trading_symbol||quote.symbol||instrumentKey,quantity:position.quantity,averagePricePaise:position.averagePricePaise,lastPricePaise,marketValuePaise:value,unrealizedPnlPaise:pnl,quoteAgeMs:age,valuationStatus:"fresh"});
    }
    res.set("Cache-Control","private, no-store");
    res.json({positions:valued,cashPaise:account.cashPaise,marketValuePaise,unrealizedPnlPaise,equityPaise:account.cashPaise+marketValuePaise,realizedPnlPaise:account.realizedPnlPaise||0,valuationStatus:staleCount?"partial_stale":"fresh",stalePositions:staleCount,simulationOnly:true});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Portfolio valuation could not be loaded."});}
});

app.get("/paper/orders",async(req,res)=>{
  try{
    const decoded=await authenticate(req),limit=Math.min(Math.max(Number.parseInt(req.query.limit||"50",10)||50,1),100);
    const snap=await db.collection("indianPaperOrders").where("uid","==",decoded.uid).orderBy("createdAt","desc").limit(limit).get();
    res.set("Cache-Control","private, no-store");
    res.json({orders:snap.docs.map(doc=>({id:doc.id,...doc.data(),createdAt:doc.data().createdAt?.toMillis?.()||null})),simulationOnly:true});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Paper order history could not be loaded."});}
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
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Watchlists could not be loaded."});}
});
app.get("/watchlist",async(req,res)=>{
  try{
    const decoded=await authenticate(req),snap=await db.collection("indianMarketWatchlists").doc(decoded.uid).get(),data=snap.exists?snap.data():{},name=requestedWatchlist(req),keys=normalizeWatchlists(data)[name];
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const items=keys.map(key=>instrumentCache.find(x=>x.instrument_key===key)).filter(Boolean).map(x=>({instrument_key:x.instrument_key,segment:x.segment,exchange:x.exchange,trading_symbol:x.trading_symbol,name:x.name,instrument_type:x.instrument_type,expiry:x.expiry??null}));
    res.set("Cache-Control","private, no-store");res.json({name,items,updatedAt:data.updatedAt?.toMillis?.()||null,maxItems:50});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Watchlist could not be loaded."});}
});
app.get("/watchlist/quotes",async(req,res)=>{
  try{
    const decoded=await authenticate(req),name=requestedWatchlist(req),snap=await db.collection("indianMarketWatchlists").doc(decoded.uid).get(),keys=normalizeWatchlists(snap.exists?snap.data():{})[name];
    if(!keys.length){res.set("Cache-Control","private, no-store");return res.json({name,quotes:[],status:"empty"});}
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists)return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(data.status!=="connected"||!data.expiresAt||data.expiresAt.toMillis()<=Date.now())return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext),quoteUrl="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
    const upstream=await fetch(quoteUrl,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}}),payload=await upstream.json().catch(()=>null);
    if(!upstream.ok)return res.status(502).json({error:"Watchlist quotes could not be retrieved.",providerStatus:upstream.status});
    const byKey=new Map(Object.values(payload?.data||{}).filter(q=>q&&typeof q.instrument_token==="string").map(q=>[q.instrument_token,q])),now=Date.now();
    const quotes=keys.map(instrumentKey=>{
      const q=byKey.get(instrumentKey),last=Number(q?.last_price),change=Number(q?.net_change),tradeTime=Number(q?.last_trade_time||0),age=tradeTime?now-tradeTime:Infinity;
      const fresh=Number.isFinite(last)&&last>0&&Number.isFinite(age)&&age>=-5000&&age<=60000,previous=last-change,percent=Number.isFinite(change)&&previous>0?(change/previous)*100:null,instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey);
      return {instrumentKey,tradingSymbol:instrument?.trading_symbol||q?.symbol||instrumentKey,lastPrice:fresh?last:null,netChange:fresh&&Number.isFinite(change)?change:null,changePercent:fresh&&Number.isFinite(percent)?percent:null,quoteAgeMs:Number.isFinite(age)?age:null,status:fresh?"fresh":"stale_or_unavailable"};
    });
    res.set("Cache-Control","private, no-store");res.json({name,quotes,asOf:now,status:quotes.every(q=>q.status==="fresh")?"fresh":"partial_stale"});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Watchlist quotes could not be loaded."});}
});
app.put("/watchlist",async(req,res)=>{
  try{
    const decoded=await authenticate(req),name=requestedWatchlist(req),raw=req.body?.instrumentKeys;
    let keys;
    try{keys=[...new Set(raw)];mergeWatchlistUpdate({},name,raw);}catch(error){return res.status(error.status||400).json({error:error.message});}
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const valid=new Set(instrumentCache.map(x=>x.instrument_key));
    if(keys.some(key=>!valid.has(key)))return res.status(400).json({error:"Watchlist contains an instrument not present in the official instrument master."});
    const ref=db.collection("indianMarketWatchlists").doc(decoded.uid);
    await db.runTransaction(async tx=>{const snap=await tx.get(ref),data=snap.exists?snap.data():{},watchlists=mergeWatchlistUpdate(data,name,keys);tx.set(ref,{uid:decoded.uid,watchlists,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});});
    res.set("Cache-Control","private, no-store");res.json({saved:true,name,count:keys.length,maxItems:50});
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:"Watchlist could not be saved."});}
});

app.post("/stream",async(req,res)=>{
  let upstream;
  let heartbeat;
  try{
    const decoded=await authenticate(req);
    const keys=[...new Set(Array.isArray(req.body?.instrumentKeys)?req.body.instrumentKeys:[])];
    const mode=req.body?.mode||"ltpc";
    if(!keys.length||keys.length>MAX_KEYS||keys.some(k=>typeof k!=="string"||!k||k.length>100||/[\u0000-\u001F]/.test(k)))
      return res.status(400).json({error:"Provide a valid instrumentKeys list within the configured per-session limit."});
    if(!["ltpc","full","option_greeks"].includes(mode)) return res.status(400).json({error:"Unsupported feed mode."});
    const connection=await db.collection("upstoxConnections").doc(decoded.uid).get();
    if(!connection.exists) return res.status(403).json({error:"Upstox account is not connected."});
    const data=connection.data();
    if(data.status!=="connected"||!data.expiresAt||data.expiresAt.toMillis()<=Date.now())
      return res.status(403).json({error:"Upstox token expired. Reconnect your account."});
    const accessToken=decryptToken(data.tokenCiphertext);
    const authResponse=await fetch("https://api.upstox.com/v3/feed/market-data-feed/authorize",{
      headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}
    });
    const authData=await authResponse.json().catch(()=>({}));
    if(!authResponse.ok||!authData.data?.authorized_redirect_uri)
      return res.status(502).json({error:"Upstox could not authorize the live market feed."});
    res.status(200);
    res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.flushHeaders?.();
    res.write("event: status\ndata: "+JSON.stringify({connected:true,mode,keys:keys.length})+"\n\n");
    upstream=new WebSocket(authData.data.authorized_redirect_uri,{followRedirects:true,headers:{Authorization:"Bearer "+accessToken,Accept:"*/*"}});
    let closed=false;
    const close=()=>{if(closed)return;closed=true;try{upstream?.close();}catch(_){}};
    upstream.on("open",()=>{
      upstream.send(Buffer.from(JSON.stringify({guid:crypto.randomUUID(),method:"sub",data:{mode,instrumentKeys:keys}})));
    });
    upstream.on("message",(bytes,isBinary)=>{
      if(!isBinary){res.write("event: upstream\ndata: "+JSON.stringify({message:String(bytes).slice(0,500)})+"\n\n");return;}
      try{
        const message=FeedResponse.decode(bytes);
        const object=FeedResponse.toObject(message,{longs:String,enums:String,defaults:false,oneofs:true});
        res.write("event: market\ndata: "+JSON.stringify(object)+"\n\n");
      }catch(error){
        res.write("event: error\ndata: "+JSON.stringify({message:"Market feed decode failed"})+"\n\n");
      }
    });
    upstream.on("error",()=>{
      if(!closed&&!res.writableEnded)res.write("event: error\ndata: "+JSON.stringify({message:"Upstream market feed connection failed"})+"\n\n");
    });
    upstream.on("close",()=>{
      if(!closed&&!res.writableEnded){
        res.write("event: status\ndata: "+JSON.stringify({connected:false})+"\n\n");
        res.end();
      }
    });
    heartbeat=setInterval(()=>{if(!closed&&!res.writableEnded)res.write(": keep-alive\n\n");},20000);
    res.on("close",()=>{clearInterval(heartbeat);close();});
  }catch(error){
    if(!res.headersSent)res.status(error.status||500).json({error:error.status?error.message:"Market feed could not be started."});
    else{res.write("event: error\ndata: "+JSON.stringify({message:"Market feed stopped unexpectedly"})+"\n\n");res.end();}
    clearInterval(heartbeat);
    try{upstream?.close();}catch(_){}
  }
});
loadProto().then(()=>{
  app.listen(PORT,"0.0.0.0",()=>console.log("Indian market gateway listening on",PORT));
  refreshInstrumentCache().catch(error=>console.error("Initial instrument refresh failed:",error.message));
}).catch(error=>{console.error("Proto load failed",error);process.exit(1);});
