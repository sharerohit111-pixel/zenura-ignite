"use strict";

const express=require("express");
const WebSocket=require("ws");
const protobuf=require("protobufjs");
const crypto=require("node:crypto");
const path=require("node:path");
const {createClient}=require("@supabase/supabase-js");
const {createSupabaseRuntime,readBearerToken}=require("./lib/supabase-runtime");
const {downloadInstrumentMaster}=require("./lib/instrument-master-download");
const {validateUpstoxFeedUrl}=require("./lib/upstox-feed-url");
const {WATCHLIST_NAMES,normalizeWatchlists,mergeWatchlistUpdate}=require("./lib/watchlists");
const {isUuid,makeOrderId,makeOrderFingerprint}=require("./lib/order-idempotency");
const {normalizeProductMode}=require("./lib/product-mode");
const {parseLimitPricePaise}=require("./lib/limit-price");
const {normalizeProviderQuote}=require("./lib/provider-quote");
const {isEligiblePaperLimitOrder,normalizeWorkerCursor,groupOrdersByUser}=require("./lib/paper-limit-worker");
const {evaluateProtectiveOrder,isSupportedProtectiveOrder,isPositionCloseable}=require("./lib/protective-order-worker");
const {buildPortfolioValuation}=require("./lib/paper-portfolio-valuation");
const {calculateDerivativePortfolio}=require("./lib/derivative-portfolio");
const {validateDerivativeContract}=require("./lib/derivative-contract");
const {parseMarginPreviewInput}=require("./lib/margin-preview-input");
const {normalizeUpstoxMarginResponse}=require("./lib/upstox-margin");
const {availablePaperCash}=require("./lib/available-paper-cash");
const {formatSseEvent,formatSseComment}=require("./lib/sse");
const {fetchProviderWithTimeout}=require("./lib/provider-fetch");
const {createSingleFlight}=require("./lib/single-flight");
const {validateStreamInstrumentKeys}=require("./lib/stream-subscription");
const {reserveUserStream,releaseUserStream}=require("./lib/stream-registry");
const {writeSseFrame,resumeUpstream}=require("./lib/stream-backpressure");
const {createStreamLifecycle}=require("./lib/stream-lifecycle");
const {sendUpstoxSubscription}=require("./lib/upstox-subscription");
const {decodeFeedResponse}=require("./lib/upstox-feed-decoder");
const {filterFreshMarketFeeds}=require("./lib/market-feed-validation");
const {createMarketFeedEventOrderFilter}=require("./lib/market-feed-event-order");
const {createLeaseHeartbeat}=require("./lib/lease-heartbeat");
const {readProviderJson}=require("./lib/provider-json");
const {decryptUpstoxToken,encryptUpstoxToken}=require("./lib/upstox-token-crypto");
const {nextUpstoxTokenExpiry}=require("../functions/lib/upstox-token-expiry");
const {isUsableUpstoxTokenResponse}=require("../functions/lib/upstox-token-response");
const {isUsableUpstoxOAuthCallback}=require("../functions/lib/upstox-oauth-callback-input");

const PORT=Number(process.env.PORT||8080);
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY=process.env.UPSTOX_TOKEN_ENCRYPTION_KEY;
const UPSTOX_CLIENT_ID=process.env.UPSTOX_CLIENT_ID;
const UPSTOX_CLIENT_SECRET=process.env.UPSTOX_CLIENT_SECRET;
const UPSTOX_REDIRECT_URI=process.env.UPSTOX_REDIRECT_URI;
const APP_REDIRECT_URI=process.env.ZENURA_APP_REDIRECT_URI||"https://zenuraignite.com/markets/stocks/";
const MAX_KEYS=Math.min(Math.max(Number(process.env.MAX_INSTRUMENT_KEYS||100)||100,1),500);
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
const INSTRUMENTS_URL="https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz";
const runtime=createSupabaseRuntime({
  supabaseUrl:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY,
  serviceRoleKey:SUPABASE_SERVICE_ROLE_KEY,createClient
});
const serviceDb=runtime.serviceDb;
const app=express();
app.use(express.json({limit:"32kb"}));
app.use((req,res,next)=>{
  const origin=req.get("origin");
  if(origin&&ALLOWED_ORIGINS.includes(origin)){
    res.set("Access-Control-Allow-Origin",origin);res.set("Vary","Origin");
    res.set("Access-Control-Allow-Headers","Authorization, Content-Type, Accept");
    res.set("Access-Control-Expose-Headers","Retry-After");
    res.set("Access-Control-Allow-Methods","GET, POST, PUT, DELETE, OPTIONS");
  }
  if(req.method==="OPTIONS")return res.sendStatus(origin&&ALLOWED_ORIGINS.includes(origin)?204:403);
  next();
});
let FeedResponse;
let instrumentCache=[];
let instrumentCacheUpdatedAt=0;
let instrumentRefreshLastAttemptAt=0;
const paperLimitWorkerStatus={enabled:false,intervalMs:null,lastRunAt:null,lastCycle:null};
const paperProtectiveWorkerStatus={enabled:false,intervalMs:null,lastRunAt:null,lastCycle:null};
const activeUserStreams=new Map();
function fetchProvider(url,options={},timeoutMs=15000){return fetchProviderWithTimeout(fetch,url,options,timeoutMs);}
function errorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.name==="TimeoutError"||error?.name==="AbortError")return 504;
  return 500;
}
function sendError(res,error,fallback){
  if(!res.headersSent)res.status(errorStatus(error)).json({error:error.status?error.message:fallback});
}
function decryptToken(box){return decryptUpstoxToken(box,ENC_KEY);}
function auth(req){
  const accessToken=readBearerToken(req);
  return runtime.authenticateRequest(req).then(user=>({user,accessToken,userDb:runtime.createUserClient(accessToken)}));
}
function localNowMs(){return Date.now();}
function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
const refreshInstrumentCache=createSingleFlight(async()=>{
  const now=Date.now();
  if(instrumentRefreshLastAttemptAt&&now-instrumentRefreshLastAttemptAt<30000)
    throw new Error("Upstox instrument master refresh is cooling down after a recent attempt.");
  instrumentRefreshLastAttemptAt=now;
  const response=await fetchProvider(INSTRUMENTS_URL,{headers:{Accept:"application/gzip"}});
  if(!response.ok)throw new Error("Upstox instrument master download failed: "+response.status);
  const parsed=await downloadInstrumentMaster(response);
  if(!Array.isArray(parsed)||!parsed.length||!parsed.every(x=>x&&typeof x.instrument_key==="string"&&typeof x.segment==="string"))
    throw new Error("Unexpected Upstox instrument master format");
  instrumentCache=parsed;instrumentCacheUpdatedAt=Date.now();return instrumentCache.length;
});
async function loadProto(){
  const root=await protobuf.load(path.join(__dirname,"proto","MarketDataFeedV3.proto"));
  FeedResponse=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
}
async function getConnection(userId){
  const {data,error}=await serviceDb.from("upstox_connections").select("*").eq("user_id",userId).maybeSingle();
  if(error)throw Object.assign(new Error("Upstox connection status could not be read"),{status:503});
  if(!data)return null;
  return {...data,tokenCiphertext:data.token_ciphertext,expiresAtMs:Date.parse(data.token_expires_at)};
}
function connectionUsable(connection){
  return !!connection&&connection.status==="connected"&&Number.isFinite(connection.expiresAtMs)&&connection.expiresAtMs>Date.now()
    &&connection.tokenCiphertext&&typeof connection.tokenCiphertext==="object";
}
async function getUpstoxAccessToken(userId){
  const connection=await getConnection(userId);
  if(!connection)throw Object.assign(new Error("Connect your Upstox account before requesting market data."),{status:403});
  if(!connectionUsable(connection))throw Object.assign(new Error("Upstox token expired. Reconnect your account."),{status:403});
  return {token:decryptToken(connection.tokenCiphertext),connection};
}
async function getQuote(accessToken,instrumentKey){
  const url="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:instrumentKey});
  const response=await fetchProvider(url,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
  const payload=await readProviderJson(response);
  if(!response.ok)throw Object.assign(new Error("A current Upstox full quote could not be verified."),{status:response.status===401?403:502});
  const quote=Object.values(payload?.data||{}).find(x=>x&&x.instrument_token===instrumentKey);
  return {quote,payload};
}
app.get("/health",(_req,res)=>res.json({
  ok:true,service:"zenura-supabase-market-gateway",authProvider:"supabase",
  feedProtocol:"upstox-v3",instrumentMasterLoaded:instrumentCache.length>0,
  instrumentMasterUpdatedAt:instrumentCacheUpdatedAt||null,
  limitWorker:{...paperLimitWorkerStatus},protectiveWorker:{...paperProtectiveWorkerStatus}
}));

app.get("/upstox/connection",async(req,res)=>{
  try{
    const {user}=await auth(req),connection=await getConnection(user.id);
    const connected=connectionUsable(connection);
    res.set("Cache-Control","private, no-store");
    res.json({connected,feedReady:connected,expiresAt:connected?connection.expiresAtMs:null,status:connected?"connected":"disconnected"});
  }catch(error){sendError(res,error,"Upstox connection status could not be loaded.");}
});
app.post("/upstox/oauth/start",async(req,res)=>{
  try{
    const {user}=await auth(req);
    if(!user.emailConfirmedAt)return res.status(403).json({error:"Verify your Supabase email before connecting Upstox.",code:"email_not_confirmed"});
    if(!UPSTOX_CLIENT_ID||!UPSTOX_REDIRECT_URI)return res.status(503).json({error:"Upstox OAuth server configuration is incomplete."});
    const state=crypto.randomBytes(32).toString("hex"),stateHash=crypto.createHash("sha256").update(state).digest("hex");
    const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
    const {error}=await serviceDb.rpc("begin_upstox_oauth",{
      p_user_id:user.id,p_state_hash:stateHash,p_expires_at:expiresAt,p_now_ms:Date.now()
    });
    if(error)throw Object.assign(new Error("Secure Upstox authorization could not be started."),{status:503});
    const params=new URLSearchParams({client_id:UPSTOX_CLIENT_ID,redirect_uri:UPSTOX_REDIRECT_URI,response_type:"code",state});
    res.set("Cache-Control","no-store");
    res.json({authorizationUrl:"https://api.upstox.com/v2/login/authorization/dialog?"+params.toString()});
  }catch(error){sendError(res,error,"Upstox authorization could not be started.");}
});
app.get("/upstox/oauth/callback",async(req,res)=>{
  const finish=(status)=>{const target=new URL(APP_REDIRECT_URI);target.searchParams.set("upstox",status);res.redirect(303,target.toString());};
  try{
    const code=String(req.query.code||""),state=String(req.query.state||"");
    if(!isUsableUpstoxOAuthCallback(code,state))return finish("error");
    if(!UPSTOX_CLIENT_ID||!UPSTOX_CLIENT_SECRET||!UPSTOX_REDIRECT_URI||!ENC_KEY)return finish("error");
    const stateHash=crypto.createHash("sha256").update(state).digest("hex");
    const {data:stateData,error:stateError}=await serviceDb.rpc("consume_upstox_oauth_state",{p_state_hash:stateHash,p_now_ms:Date.now()});
    if(stateError||!stateData?.user_id)return finish("error");
    const tokenResponse=await fetchProvider("https://api.upstox.com/v2/login/authorization/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
      body:new URLSearchParams({code,client_id:UPSTOX_CLIENT_ID,client_secret:UPSTOX_CLIENT_SECRET,redirect_uri:UPSTOX_REDIRECT_URI,grant_type:"authorization_code"})
    });
    const tokenPayload=await readProviderJson(tokenResponse);
    if(!tokenResponse.ok||!isUsableUpstoxTokenResponse(tokenPayload))return finish("error");
    const issuedAt=new Date(),expiresAt=new Date(nextUpstoxTokenExpiry(issuedAt.getTime()));
    const scopes=Array.isArray(tokenPayload.scope)?tokenPayload.scope.filter(x=>typeof x==="string").slice(0,30):[];
    const {data:saved,error:saveError}=await serviceDb.rpc("save_upstox_connection",{
      p_user_id:stateData.user_id,p_generation:stateData.connection_generation,
      p_token_ciphertext:encryptUpstoxToken(tokenPayload.access_token,ENC_KEY),
      p_token_type:tokenPayload.token_type||"Bearer",p_token_expires_at:expiresAt.toISOString(),
      p_token_issued_at:issuedAt.toISOString(),p_scopes:scopes,p_now_ms:issuedAt.getTime()
    });
    if(saveError||saved!==true)return finish("error");
    finish("connected");
  }catch(error){
    console.error("Supabase Upstox callback failed:",error.message);
    finish("error");
  }
});
app.delete("/upstox/connection",async(req,res)=>{
  try{
    const {user}=await auth(req);
    const {data,error}=await serviceDb.rpc("disconnect_upstox_connection",{p_user_id:user.id,p_now_ms:Date.now()});
    if(error)throw Object.assign(new Error("Upstox connection could not be safely revoked."),{status:503});
    res.set("Cache-Control","no-store").json({disconnected:true,generation:data,feedReady:false});
  }catch(error){sendError(res,error,"Upstox disconnect failed.");}
});

app.get("/instruments",async(req,res)=>{
  try{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const kind=String(req.query.kind||"all").toLowerCase(),exchange=String(req.query.exchange||"").toUpperCase();
    const q=String(req.query.q||"").trim().toLowerCase().slice(0,60);
    const limit=Math.min(Math.max(Number.parseInt(req.query.limit||"50",10)||50,1),100);
    const matches=instrumentCache.filter(item=>{
      if(exchange&&item.exchange!==exchange)return false;
      if(kind==="equities"&&!(item.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(item.segment)))return false;
      if(kind==="indices"&&!(item.instrument_type==="INDEX"&&["NSE_INDEX","BSE_INDEX"].includes(item.segment)))return false;
      if(kind==="futures"&&!(item.instrument_type==="FUT"&&["NSE_FO","BSE_FO"].includes(item.segment)))return false;
      if(kind==="options"&&!((["CE","PE"].includes(item.instrument_type))&&["NSE_FO","BSE_FO"].includes(item.segment)))return false;
      if(q&&!String(item.trading_symbol||"").toLowerCase().includes(q)&&!String(item.name||"").toLowerCase().includes(q)&&!String(item.underlying_symbol||"").toLowerCase().includes(q))return false;
      return true;
    }).slice(0,limit).map(item=>({
      instrument_key:item.instrument_key,segment:item.segment,exchange:item.exchange,
      name:item.name,trading_symbol:item.trading_symbol,instrument_type:item.instrument_type,
      expiry:item.expiry??null,strike_price:item.strike_price??null,
      lot_size:item.lot_size??null,tick_size:item.tick_size??null,
      underlying_symbol:item.underlying_symbol??null
    }));
    res.set("Cache-Control","public, max-age=60").json({source:"Upstox BOD instrument master",updatedAt:instrumentCacheUpdatedAt,count:matches.length,results:matches});
  }catch(error){sendError(res,error,"Official instrument master is temporarily unavailable.");}
});
app.get("/candles",async(req,res)=>{
  try{
    const {user}=await auth(req);
    const instrumentKey=String(req.query.instrument_key||""),unit=String(req.query.unit||""),interval=Number(req.query.interval);
    const toDate=String(req.query.to_date||""),fromDate=String(req.query.from_date||"");
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))return res.status(400).json({error:"A valid instrument_key is required."});
    const validUnit=["minutes","hours","days","weeks","months"].includes(unit);
    const validInterval=Number.isInteger(interval)&&((unit==="minutes"&&interval>=1&&interval<=300)||(unit==="hours"&&interval>=1&&interval<=5)||(["days","weeks","months"].includes(unit)&&interval===1));
    if(!validUnit||!validInterval)return res.status(400).json({error:"Unsupported candle unit or interval."});
    if(!validDate(toDate)||(fromDate&&!validDate(fromDate)))return res.status(400).json({error:"Dates must use YYYY-MM-DD format."});
    if(fromDate&&fromDate>toDate)return res.status(400).json({error:"from_date must not be after to_date."});
    if(fromDate){
      const days=(new Date(toDate+"T00:00:00Z")-new Date(fromDate+"T00:00:00Z"))/86400000;
      const maxDays=unit==="minutes"?(interval<=15?31:92):unit==="hours"?92:unit==="days"?3653:Infinity;
      if(days>maxDays)return res.status(400).json({error:"Requested date range exceeds the supported historical window."});
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    if(!instrumentCache.some(item=>item.instrument_key===instrumentKey))return res.status(400).json({error:"Instrument key is not present in the official instrument master."});
    const {token}=await getUpstoxAccessToken(user.id);
    const parts=[encodeURIComponent(instrumentKey),unit,String(interval),encodeURIComponent(toDate)];
    if(fromDate)parts.push(encodeURIComponent(fromDate));
    const upstream=await fetchProvider("https://api.upstox.com/v3/historical-candle/"+parts.join("/"),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const payload=await readProviderJson(upstream);
    if(!upstream.ok)return res.status(upstream.status===401?403:502).json({error:"Upstox historical candle request failed.",providerStatus:upstream.status});
    res.set("Cache-Control","private, no-store").json(payload);
  }catch(error){sendError(res,error,"Historical candles could not be loaded.");}
});
app.get("/option-chain",async(req,res)=>{
  try{
    const {user}=await auth(req),instrumentKey=String(req.query.instrument_key||""),expiry=String(req.query.expiry_date||"");
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))return res.status(400).json({error:"A valid underlying instrument_key is required."});
    const relative=["current_week","next_week","far_week","current_month","next_month","far_month"];
    if(!relative.includes(expiry)&&!validDate(expiry))return res.status(400).json({error:"expiry_date must be YYYY-MM-DD or a supported expiry keyword."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const underlying=instrumentCache.find(item=>item.instrument_key===instrumentKey);
    if(!underlying||!["NSE_INDEX","BSE_INDEX","NSE_EQ","BSE_EQ"].includes(underlying.segment))return res.status(400).json({error:"Select a verified NSE/BSE equity or index underlying."});
    const {token}=await getUpstoxAccessToken(user.id);
    const params=new URLSearchParams({instrument_key:instrumentKey,expiry_date:expiry});
    const upstream=await fetchProvider("https://api.upstox.com/v2/option/chain?"+params,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const payload=await readProviderJson(upstream);
    if(!upstream.ok)return res.status(upstream.status===401?403:502).json({error:"Upstox option-chain request failed.",providerStatus:upstream.status});
    res.set("Cache-Control","private, no-store").json(payload);
  }catch(error){sendError(res,error,"Option chain could not be loaded.");}
});

app.get("/paper/account",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    const initialized=await runtime.callUserRpc(user,"initialize_paper_trading_account",{});
    const {data,error}=await userDb.from("paper_accounts").select("*").eq("user_id",user.id).maybeSingle();
    if(error||!data)return res.status(409).json({error:"Paper Trading account could not be initialized or read."});
    res.set("Cache-Control","private, no-store").json({
      cashPaise:data.cash_paise,reservedCashPaise:data.reserved_cash_paise||0,
      reservedMarginPaise:data.reserved_margin_paise||0,realizedPnlPaise:data.realized_pnl_paise||0,
      version:data.version,created:initialized?.created===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Paper account could not be loaded.");}
});

function watchlistName(req){
  const name=String(req.query?.name||req.body?.name||"My Stocks");
  if(!WATCHLIST_NAMES.includes(name))throw Object.assign(new Error("Choose a valid watchlist name."),{status:400});
  return name;
}
async function readWatchlists(userDb,userId){
  const {data,error}=await userDb.from("paper_watchlists").select("name,instrument_keys,updated_at").eq("user_id",userId);
  if(error)throw Object.assign(new Error("Watchlists could not be read."),{status:503});
  const result={};for(const name of WATCHLIST_NAMES)result[name]=[];
  for(const row of data||[])if(WATCHLIST_NAMES.includes(row.name)&&Array.isArray(row.instrument_keys))result[row.name]=row.instrument_keys;
  return result;
}
function publicInstrument(item){return {instrument_key:item.instrument_key,segment:item.segment,exchange:item.exchange,trading_symbol:item.trading_symbol,name:item.name,instrument_type:item.instrument_type,expiry:item.expiry??null,strike_price:item.strike_price??null,lot_size:item.lot_size??null,tick_size:item.tick_size??null,underlying_symbol:item.underlying_symbol??null};}
app.get("/watchlists",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),watchlists=await readWatchlists(userDb,user.id);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const mapped={};for(const name of WATCHLIST_NAMES)mapped[name]=watchlists[name].map(key=>instrumentCache.find(x=>x.instrument_key===key)).filter(Boolean).map(publicInstrument);
    res.set("Cache-Control","private, no-store").json({watchlists:mapped,names:WATCHLIST_NAMES,maxItemsPerList:50});
  }catch(error){sendError(res,error,"Watchlists could not be loaded.");}
});
app.get("/watchlist",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),name=watchlistName(req),watchlists=await readWatchlists(userDb,user.id);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const items=watchlists[name].map(key=>instrumentCache.find(x=>x.instrument_key===key)).filter(Boolean).map(publicInstrument);
    res.set("Cache-Control","private, no-store").json({name,items,maxItems:50});
  }catch(error){sendError(res,error,"Watchlist could not be loaded.");}
});
app.put("/watchlist",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),name=watchlistName(req),raw=req.body?.instrumentKeys;
    if(!Array.isArray(raw)||raw.length>50||raw.some(x=>typeof x!=="string"||!x||x.length>100))return res.status(400).json({error:"Watchlist must contain up to 50 valid instrument keys."});
    const keys=[...new Set(raw)];
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const valid=new Set(instrumentCache.map(x=>x.instrument_key));
    if(keys.some(key=>!valid.has(key)))return res.status(400).json({error:"Watchlist contains an instrument not present in the official instrument master."});
    const {error}=await userDb.from("paper_watchlists").upsert({user_id:user.id,name,instrument_keys:keys,updated_at:new Date().toISOString()},{onConflict:"user_id,name"});
    if(error)throw Object.assign(new Error("Watchlist could not be saved."),{status:503});
    res.set("Cache-Control","private, no-store").json({saved:true,name,count:keys.length,maxItems:50});
  }catch(error){sendError(res,error,"Watchlist could not be saved.");}
});


app.post("/paper/orders",async(req,res)=>{
  try{
    const {user}=await auth(req);
    const instrumentKey=typeof req.body?.instrument_key==="string"?req.body.instrument_key:"";
    const side=String(req.body?.side||"").toUpperCase();
    const orderType=String(req.body?.order_type||"MARKET").toUpperCase();
    const product=normalizeProductMode(req.body?.product);
    const quantity=Number(req.body?.quantity);
    const idempotencyKey=typeof req.body?.idempotency_key==="string"?req.body.idempotency_key:"";
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))return res.status(400).json({error:"A valid instrument_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Only BUY and SELL paper orders are supported."});
    if(!["MARKET","LIMIT"].includes(orderType))return res.status(400).json({error:"Only MARKET and LIMIT paper orders are supported."});
    if(product===null)return res.status(400).json({error:"product must be DELIVERY or INTRADAY."});
    if(orderType==="LIMIT"&&product==="INTRADAY")return res.status(400).json({error:"Intraday LIMIT orders are not enabled yet; use Delivery LIMIT or Intraday MARKET."});
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return res.status(400).json({error:"Quantity must be a whole number between 1 and 1,000,000."});
    let limitPricePaise;
    if(orderType==="LIMIT"){
      limitPricePaise=req.body?.limit_price_paise!==undefined?Number(req.body.limit_price_paise):parseLimitPricePaise(req.body?.limit_price);
      if(!Number.isSafeInteger(limitPricePaise)||limitPricePaise<1)return res.status(400).json({error:"LIMIT orders require a valid positive price in paise."});
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE cash-equity instrument from the official instrument master."});
    const orderId=makeOrderId(user.id,idempotencyKey);
    const requestFingerprint=makeOrderFingerprint({instrumentKey,side,quantity,orderType,product,...(orderType==="LIMIT"?{limitPricePaise}:{})});
    if(orderType==="LIMIT"){
      const {normalizeTickSizePaise}=require("./lib/derivative-contract");
      const tick=normalizeTickSizePaise(Number(instrument.tick_size));
      if(!tick||limitPricePaise%tick!==0)return res.status(400).json({error:"LIMIT price must match the official instrument tick size."});
      const result=await runtime.callUserRpc(user,"submit_paper_limit_order",{
        p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:requestFingerprint,
        p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol||instrument.name,
        p_exchange:instrument.exchange,p_side:side,p_quantity:quantity,p_limit_price_paise:limitPricePaise
      });
      res.set("Cache-Control","private, no-store");
      return res.status(result?.idempotent_replay?200:201).json({
        orderId:result?.order_id||orderId,status:result?.status||"PENDING",
        quantity,side,product,orderType,limitPricePaise,
        cashPaise:result?.cash_paise??null,reservedCashPaise:result?.reserved_cash_paise??null,
        idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
      });
    }
    const {token}=await getUpstoxAccessToken(user.id);
    const {quote}=await getQuote(token,instrumentKey);
    const normalized=normalizeProviderQuote(quote,instrumentKey);
    const result=await runtime.callUserRpc(user,"execute_paper_market_order",{
      p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:requestFingerprint,
      p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol||instrument.name,
      p_exchange:instrument.exchange,p_side:side,p_product:product,p_quantity:quantity,
      p_execution_price_paise:normalized.pricePaise,p_quote_timestamp_ms:normalized.tradeTimeMs,
      p_quote_age_ms:normalized.quoteAgeMs
    });
    res.set("Cache-Control","private, no-store");
    res.status(result?.idempotent_replay?200:201).json({
      orderId:result?.order_id||orderId,status:result?.status||"FILLED",side,product,orderType,
      quantity,executionPricePaise:normalized.pricePaise,grossPaise:result?.gross_paise??null,
      cashPaise:result?.cash_paise??null,realizedPnlPaise:result?.order_realized_pnl_paise??0,
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Paper order could not be completed.");}
});
app.post("/paper/orders/:orderId/cancel",async(req,res)=>{
  try{
    const {user}=await auth(req),orderId=String(req.params.orderId||"");
    if(!/^[a-f0-9]{64}$/.test(orderId))return res.status(400).json({error:"Invalid paper order id."});
    const result=await runtime.callUserRpc(user,"cancel_paper_limit_order",{p_order_id:orderId});
    res.set("Cache-Control","private, no-store").json({orderId,status:result?.status||"CANCELLED",cashPaise:result?.cash_paise??null,reservedCashPaise:result?.reserved_cash_paise??null,simulationOnly:true});
  }catch(error){sendError(res,error,"LIMIT order cancellation failed.");}
});
app.post("/paper/protective-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    const orderId=String(req.body?.order_id||""),instrumentKey=String(req.body?.instrument_key||"");
    const product=String(req.body?.product||"").toUpperCase(),triggerType=String(req.body?.trigger_type||"").toUpperCase();
    const triggerPricePaise=Number(req.body?.trigger_price_paise),quantity=Number(req.body?.quantity);
    if(!isUuid(orderId)||!instrumentKey||instrumentKey.length>100
       ||!["DELIVERY","INTRADAY"].includes(product)||!["STOP_LOSS","TARGET"].includes(triggerType)
       ||!Number.isSafeInteger(triggerPricePaise)||triggerPricePaise<1
       ||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)
      return res.status(400).json({error:"Invalid equity protective order details."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(item=>item.instrument_key===instrumentKey
      &&item.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(item.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE cash equity instrument."});
    const {data,error}=await userDb.rpc("create_paper_equity_protective_order",{
      p_order_id:orderId,p_user_id:user.id,p_instrument_key:instrumentKey,p_product:product,
      p_trigger_type:triggerType,p_trigger_price_paise:triggerPricePaise,p_quantity:quantity
    });
    if(error)throw Object.assign(new Error("Equity protective order could not be created."),{status:409});
    const order=data?.order||{};
    res.set("Cache-Control","private, no-store").status(data?.idempotent_replay?200:201).json({
      orderId:order.order_id||orderId,instrumentKey:order.instrument_key||instrumentKey,
      tradingSymbol:instrument.trading_symbol,product:order.product||product,side:"SELL",
      triggerType:order.trigger_type||triggerType,triggerDirection:order.trigger_direction,
      triggerPricePaise:order.trigger_price_paise??triggerPricePaise,quantity:order.quantity??quantity,
      status:order.status||"ACTIVE",idempotentReplay:data?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Equity protective order could not be created.");}
});
app.get("/paper/protective-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Protective order limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_protective_orders").select("order_id,instrument_key,product,side,trigger_type,trigger_direction,trigger_price_paise,quantity,status,created_at,filled_at,cancelled_at,execution_price_paise")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Protective order history could not be loaded."),{status:503});
    const orders=(data||[]).map(order=>({orderId:order.order_id,instrumentKey:order.instrument_key,product:order.product,
      side:order.side,triggerType:order.trigger_type,triggerDirection:order.trigger_direction,
      triggerPricePaise:order.trigger_price_paise,quantity:order.quantity,status:order.status,
      executionPricePaise:order.execution_price_paise,createdAt:order.created_at,
      filledAt:order.filled_at,cancelledAt:order.cancelled_at,simulationOnly:true}));
    res.set("Cache-Control","private, no-store").json({orders,simulationOnly:true});
  }catch(error){sendError(res,error,"Protective order history could not be loaded.");}
});
app.post("/paper/protective-orders/:orderId/cancel",async(req,res)=>{
  try{
    const {user}=await auth(req),orderId=String(req.params.orderId||"");
    if(!/^[0-9a-f-]{36}$/i.test(orderId))return res.status(400).json({error:"Invalid protective order id."});
    const {data:result,error}=await userDb.rpc("cancel_paper_protective_order",{p_protective_order_id:orderId,p_user_id:user.id});
    if(error)throw Object.assign(new Error("Protective order cancellation could not be completed."),{status:409});
    res.set("Cache-Control","private, no-store").json({
      orderId,status:result?.status||"UNKNOWN",
      cancelled:result?.cancelled===true,
      alreadyFilled:result?.already_filled===true,
      idempotentReplay:result?.idempotent_replay===true,
      simulationOnly:true
    });
  }catch(error){sendError(res,error,"Protective order cancellation failed.");}
});
app.get("/paper/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Order history limit must be a whole number from 1 to 100."});
    const limit=Math.min(Number(raw),100);
    const {data,error}=await userDb.from("paper_orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(limit);
    if(error)throw Object.assign(new Error("Paper order history could not be loaded."),{status:503});
    const orders=(data||[]).map(o=>({id:o.order_id,tradingSymbol:o.trading_symbol,exchange:o.exchange,side:o.side,quantity:o.quantity,product:o.product,executionPricePaise:o.execution_price_paise,limitPricePaise:o.limit_price_paise,grossPaise:o.gross_paise,realizedPnlPaise:o.realized_pnl_paise,orderType:o.order_type,status:o.status,simulationOnly:true,createdAt:o.created_at?Date.parse(o.created_at):null}));
    res.set("Cache-Control","private, no-store").json({orders,hasMore:false,nextCursor:null,simulationOnly:true});
  }catch(error){sendError(res,error,"Paper order history could not be loaded.");}
});
app.get("/paper/portfolio",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),product=normalizeProductMode(req.query.product);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    if(product===null)return res.status(400).json({error:"product must be DELIVERY or INTRADAY."});
    const [{data:account,error:accountError},{data:rows,error:positionError}]=await Promise.all([
      userDb.from("paper_accounts").select("*").eq("user_id",user.id).maybeSingle(),
      userDb.from("paper_equity_positions").select("*").eq("user_id",user.id).eq("product",product)
    ]);
    if(accountError||!account)return res.status(404).json({error:"Indian paper account has not been initialized."});
    if(positionError)throw Object.assign(new Error("Paper positions could not be loaded."),{status:503});
    const positions=(rows||[]).map(p=>[p.instrument_key,{quantity:p.quantity,averagePricePaise:p.average_price_paise,costBasisPaise:p.cost_basis_paise}]).filter(([,p])=>p.quantity>0);
    const realized=product==="INTRADAY"?(account.intraday_realized_pnl_paise||0):(account.delivery_realized_pnl_paise??account.realized_pnl_paise??0);
    if(!positions.length)return res.set("Cache-Control","private, no-store").json({product,positions:[],cashPaise:account.cash_paise,marketValuePaise:0,unrealizedPnlPaise:0,equityPaise:account.cash_paise,realizedPnlPaise:realized,valuationStatus:"no_open_positions",stalePositions:0,simulationOnly:true});
    if(positions.length>50)return res.status(409).json({error:"Portfolio contains more than 50 open positions; valuation stopped."});
    const {token}=await getUpstoxAccessToken(user.id),keys=positions.map(([key])=>key);
    const response=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const payload=await readProviderJson(response);
    if(!response.ok)return res.status(502).json({error:"Portfolio market valuation could not be retrieved."});
    const valuation=buildPortfolioValuation({positions,quotes:Object.values(payload?.data||{}),cashPaise:account.cash_paise,realizedPnlPaise:realized,instruments:instrumentCache,now:Date.now(),maxAgeMs:60000});
    res.set("Cache-Control","private, no-store").json({...valuation,product});
  }catch(error){sendError(res,error,"Portfolio valuation could not be loaded.");}
});
app.post("/paper/derivative/margin-preview",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),{instrumentKey,lots,side,product}=parseMarginPreviewInput(req.body);
    const {token}=await getUpstoxAccessToken(user.id);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="FUT"&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE futures contract from the official instrument master."});
    const rate=await serviceDb.rpc("consume_paper_margin_preview_slot",{p_user_id:user.id,p_now_ms:Date.now(),p_min_interval_ms:5000});
    if(rate.error||rate.data!==true)return res.status(429).set("Retry-After","5").json({error:"Please wait before requesting another broker margin preview."});
    const {quote}=await getQuote(token,instrumentKey),normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
    const upstream=await fetchProvider("https://api.upstox.com/v2/charges/margin",{
      method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
      body:JSON.stringify({instruments:[{instrument_key:instrumentKey,quantity:contract.quantity,product,transaction_type:side,price:normalized.pricePaise/100}]})
    });
    const payload=await readProviderJson(upstream);
    if(!upstream.ok)return res.status(502).json({error:"Upstox broker margin preview failed."});
    const margin=normalizeUpstoxMarginResponse(payload,instrumentKey);
    const {data:account,error}=await userDb.from("paper_accounts").select("cash_paise,reserved_cash_paise,reserved_margin_paise").eq("user_id",user.id).maybeSingle();
    if(error||!account)return res.status(409).json({error:"Initialize your Paper Trading account before comparing margin."});
    const availableCashPaise=availablePaperCash(account);
    res.set("Cache-Control","private, no-store").json({
      status:"PREVIEW_ONLY",tradingSymbol:instrument.trading_symbol,instrumentKey,exchange:instrument.exchange,
      expiry:contract.expiry,side,product,lots,lotSize:contract.lotSize,quantity:contract.quantity,
      quote:{pricePaise:normalized.pricePaise,observedAtMs:normalized.tradeTimeMs},
      requiredMarginPaise:margin.requiredMarginPaise,finalMarginPaise:margin.finalMarginPaise,
      marginComponents:margin.components,availableVirtualCashPaise:availableCashPaise,
      shortfallPaise:Math.max(margin.requiredMarginPaise-availableCashPaise,0),
      source:margin.source,simulationOnly:true,previewOnly:true,executionEnabled:false,persisted:false,marginReserved:false
    });
  }catch(error){sendError(res,error,"Futures margin preview could not be completed.");}
});
app.post("/paper/derivative/orders",async(req,res)=>{
  try{
    const {user}=await auth(req),instrumentKey=String(req.body?.instrument_key||"");
    const lots=Number(req.body?.lots),side=String(req.body?.side||"").toUpperCase(),idempotencyKey=String(req.body?.idempotency_key||"");
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Only BUY and SELL to close existing long CE/PE positions are supported."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&["CE","PE"].includes(x.instrument_type)&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE CE/PE contract from the official instrument master."});
    const {token}=await getUpstoxAccessToken(user.id),{quote}=await getQuote(token,instrumentKey);
    const normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
    const orderId=makeOrderId(user.id,idempotencyKey),fingerprint=makeOrderFingerprint({instrumentKey,side,quantity:contract.quantity});
    const result=await runtime.callUserRpc(user,"execute_paper_long_option_order",{
      p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:fingerprint,
      p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol,p_exchange:instrument.exchange,
      p_segment:instrument.segment,p_instrument_type:instrument.instrument_type,p_expiry:contract.expiry,
      p_strike_price:instrument.strike_price,p_lot_size:contract.lotSize,p_tick_size_paise:contract.tickSizePaise,
      p_lots:lots,p_side:side,p_execution_price_paise:normalized.pricePaise,
      p_quote_timestamp_ms:normalized.tradeTimeMs,p_now_ms:Date.now()
    });
    const order=result?.order||{};
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      orderId:result?.order_id||orderId,tradingSymbol:order.trading_symbol||instrument.trading_symbol,
      instrumentKey,side,quantity:order.quantity??contract.quantity,lots,
      executionPricePaise:order.execution_price_paise??normalized.pricePaise,
      grossPaise:order.gross_paise??null,chargesPaise:order.charges_paise??0,
      totalDebitPaise:order.total_debit_paise??null,netCreditPaise:order.net_credit_paise??null,
      cashPaise:result?.cash_paise??null,realizedPnlPaise:result?.realized_pnl_paise??0,
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true,excludesCharges:false
    });
  }catch(error){sendError(res,error,"Derivative paper order could not be completed.");}
});
app.get("/paper/derivative/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Derivative order history limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_derivative_orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Derivative order history could not be loaded."),{status:503});
    const orders=(data||[]).map(o=>({id:o.order_id,tradingSymbol:o.trading_symbol,instrumentKey:o.instrument_key,instrumentType:o.instrument_type,expiry:o.expiry,side:o.side,quantity:o.quantity,lots:o.lots,executionPricePaise:o.execution_price_paise,grossPaise:o.gross_paise,chargesPaise:o.charges_paise||0,totalDebitPaise:o.total_debit_paise??null,netCreditPaise:o.net_credit_paise??null,status:o.status,orderType:o.order_type,simulationOnly:true,createdAt:o.created_at?Date.parse(o.created_at):null}));
    res.set("Cache-Control","private, no-store").json({orders,simulationOnly:true,excludesCharges:false});
  }catch(error){sendError(res,error,"Derivative order history could not be loaded.");}
});
app.get("/paper/derivatives/portfolio",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    const [{data:account,error:accountError},{data:rows,error:positionError}]=await Promise.all([
      userDb.from("paper_accounts").select("cash_paise,realized_pnl_paise").eq("user_id",user.id).maybeSingle(),
      userDb.from("paper_derivative_positions").select("*").eq("user_id",user.id)
    ]);
    if(accountError||!account)return res.status(404).json({error:"Indian paper account has not been initialized."});
    if(positionError)throw Object.assign(new Error("Derivative positions could not be loaded."),{status:503});
    const positions=(rows||[]).map(p=>({instrumentKey:p.instrument_key,instrumentType:p.instrument_type,netQuantity:p.net_quantity,averagePricePaise:p.average_price_paise,costBasisPaise:p.cost_basis_paise}));
    if(!positions.length)return res.set("Cache-Control","private, no-store").json({positions:[],cashPaise:account.cash_paise,marketValuePaise:0,unrealizedPnlPaise:0,reservedMarginPaise:0,realizedPnlPaise:account.realized_pnl_paise||0,valuationStatus:"no_open_positions",simulationOnly:true,includesEntryCharges:true,excludesEstimatedExitCharges:true});
    const {token}=await getUpstoxAccessToken(user.id),keys=positions.map(p=>p.instrumentKey);
    const upstream=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const payload=await readProviderJson(upstream);
    if(!upstream.ok)return res.status(502).json({error:"Derivative portfolio quotes could not be retrieved."});
    const quotes=[];
    for(const p of positions){
      const entry=Object.values(payload?.data||{}).find(x=>x?.instrument_token===p.instrumentKey);
      const q=normalizeProviderQuote(entry,p.instrumentKey,{maxAgeMs:15000});
      quotes.push({instrumentKey:p.instrumentKey,pricePaise:q.pricePaise,observedAtMs:q.tradeTimeMs});
    }
    const valuation=calculateDerivativePortfolio({positions,quotes,now:Date.now()});
    res.set("Cache-Control","private, no-store").json({...valuation,cashPaise:account.cash_paise,realizedPnlPaise:account.realized_pnl_paise||0,simulationOnly:true,includesEntryCharges:true,excludesEstimatedExitCharges:true});
  }catch(error){sendError(res,error,"Derivative portfolio valuation could not be loaded.");}
});

app.get("/watchlist/quotes",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),name=watchlistName(req),watchlists=await readWatchlists(userDb,user.id),keys=watchlists[name];
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    if(!keys.length)return res.set("Cache-Control","private, no-store").json({name,quotes:[],status:"empty"});
    const {token}=await getUpstoxAccessToken(user.id);
    const response=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const payload=await readProviderJson(response);
    if(!response.ok)return res.status(502).json({error:"Watchlist quotes could not be retrieved."});
    const entries=Object.values(payload?.data||{}),now=Date.now();
    const quotes=keys.map(instrumentKey=>{
      const entry=entries.find(x=>x?.instrument_token===instrumentKey),instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey);
      let normalized=null;try{normalized=normalizeProviderQuote(entry,instrumentKey,{now,maxAgeMs:60000});}catch(_){}
      const change=Number(entry?.net_change),last=normalized?normalized.pricePaise/100:null,previous=last!==null&&Number.isFinite(change)?last-change:null;
      return {instrumentKey,tradingSymbol:instrument?.trading_symbol||entry?.symbol||instrumentKey,
        lastPrice:normalized?last:null,netChange:normalized&&Number.isFinite(change)?change:null,
        changePercent:normalized&&previous>0?(change/previous)*100:null,
        quoteAgeMs:normalized?.quoteAgeMs??null,status:normalized?"fresh":"stale_or_unavailable"};
    });
    res.set("Cache-Control","private, no-store").json({name,quotes,asOf:now,status:quotes.every(x=>x.status==="fresh")?"fresh":"partial_stale"});
  }catch(error){sendError(res,error,"Watchlist quotes could not be loaded.");}
});
app.post("/paper/futures/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),instrumentKey=String(req.body?.instrument_key||"");
    const lots=Number(req.body?.lots),side=String(req.body?.side||"").toUpperCase();
    const rawProduct=String(req.body?.product||"D").toUpperCase();
    const product=rawProduct==="I"?"INTRADAY":rawProduct==="D"?"DELIVERY":normalizeProductMode(rawProduct);
    const idempotencyKey=String(req.body?.idempotency_key||"");
    const orderType=String(req.body?.order_type||"MARKET").toUpperCase();
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(orderType!=="MARKET")return res.status(400).json({error:"Futures LIMIT orders will be enabled after the protected LIMIT worker is deployed. MARKET is currently supported."});
    if(!["BUY","SELL"].includes(side)||product===null)return res.status(400).json({error:"Choose BUY/SELL and a valid Intraday/Delivery futures product."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="FUT"&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE futures contract from the official instrument master."});
    const {token}=await getUpstoxAccessToken(user.id),{quote}=await getQuote(token,instrumentKey);
    const normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
    const orderId=makeOrderId(user.id,idempotencyKey);
    const fingerprint=makeOrderFingerprint({instrumentKey,side,quantity:contract.quantity,orderType:"MARKET",product});
    const {data:prior,error:priorError}=await userDb.from("paper_futures_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(priorError)throw Object.assign(new Error("Futures order idempotency state could not be checked."),{status:503});
    if(prior){
      if(prior.request_fingerprint!==fingerprint||prior.order_id!==orderId)return res.status(409).json({error:"Futures idempotency key was reused with different order details."});
      const {data:account}=await userDb.from("paper_accounts").select("cash_paise,reserved_margin_paise").eq("user_id",user.id).maybeSingle();
      return res.set("Cache-Control","private, no-store").json({orderId:prior.order_id,status:prior.status,side:prior.side,product:prior.product,quantity:prior.quantity,lots:prior.quantity/prior.lot_size,executionPricePaise:prior.execution_price_paise,grossPaise:prior.execution_price_paise*prior.quantity,chargesPaise:prior.charges_paise,cashPaise:account?.cash_paise??null,reservedMarginPaise:account?.reserved_margin_paise??null,realizedPnlPaise:prior.realized_pnl_paise,idempotentReplay:true,simulationOnly:true});
    }
    const {data:position,error:positionError}=await userDb.from("paper_futures_positions").select("net_quantity,product").eq("user_id",user.id).eq("instrument_key",instrumentKey).maybeSingle();
    if(positionError)throw Object.assign(new Error("Current futures position could not be read."),{status:503});
    if(position&&position.product!==product)return res.status(409).json({error:"Close the existing futures position before switching between Intraday and Delivery."});
    const oldQuantity=position?.net_quantity||0;
    const opensSameDirection=oldQuantity===0||(oldQuantity>0&&side==="BUY")||(oldQuantity<0&&side==="SELL");
    const openingQuantity=opensSameDirection?contract.quantity:Math.max(0,contract.quantity-Math.abs(oldQuantity));
    let openingMarginPaise=0;
    if(openingQuantity>0){
      const marginResponse=await fetchProvider("https://api.upstox.com/v2/charges/margin",{
        method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
        body:JSON.stringify({instruments:[{instrument_key:instrumentKey,quantity:openingQuantity,product:product==="INTRADAY"?"I":"D",transaction_type:side,price:normalized.pricePaise/100}]})
      });
      const marginPayload=await readProviderJson(marginResponse);
      if(!marginResponse.ok)return res.status(502).json({error:"Upstox futures margin requirement could not be verified."});
      openingMarginPaise=normalizeUpstoxMarginResponse(marginPayload,instrumentKey).requiredMarginPaise;
    }
    const {calculateFuturesTradeCharges}=require("./lib/trading-charges");
    const charges=calculateFuturesTradeCharges({grossPaise:contract.contractValuePaise,exchange:instrument.exchange,side});
    const now=Date.now();
    const result=await runtime.callUserRpc(user,"execute_paper_futures_market_order",{
      p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:fingerprint,
      p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol,p_exchange:instrument.exchange,
      p_segment:instrument.segment,p_expiry:contract.expiry,p_lot_size:contract.lotSize,
      p_tick_size_paise:contract.tickSizePaise,p_side:side,p_product:product,p_quantity:contract.quantity,
      p_execution_price_paise:normalized.pricePaise,p_open_margin_paise:openingMarginPaise,
      p_charges_paise:charges.totalChargesPaise,p_quote_timestamp_ms:normalized.tradeTimeMs,p_now_ms:now
    });
    const order=result?.order||{};
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      orderId:order.order_id||orderId,status:order.status||"FILLED",tradingSymbol:instrument.trading_symbol,
      instrumentKey,exchange:instrument.exchange,expiry:contract.expiry,side,product,orderType:"MARKET",
      lots,lotSize:contract.lotSize,quantity:contract.quantity,executionPricePaise:normalized.pricePaise,
      grossPaise:contract.contractValuePaise,chargesPaise:charges.totalChargesPaise,charges,
      openingMarginPaise:openingMarginPaise,cashPaise:result?.cash_paise??null,
      reservedMarginPaise:result?.reserved_margin_paise??null,
      realizedPnlPaise:result?.order_realized_pnl_paise??0,
      quoteAgeMs:normalized.quoteAgeMs,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Futures paper order could not be completed.");}
});
app.get("/paper/futures/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Futures order history limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_futures_orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Futures order history could not be loaded."),{status:503});
    const orders=(data||[]).map(o=>({id:o.order_id,tradingSymbol:o.trading_symbol,instrumentKey:o.instrument_key,exchange:o.exchange,expiry:o.expiry,side:o.side,product:o.product,quantity:o.quantity,lotSize:o.lot_size,executionPricePaise:o.execution_price_paise,marginReservedPaise:o.margin_reserved_paise,chargesPaise:o.charges_paise,realizedPnlPaise:o.realized_pnl_paise,status:o.status,orderType:o.order_type,simulationOnly:true,createdAt:o.created_at?Date.parse(o.created_at):null}));
    res.set("Cache-Control","private, no-store").json({orders,simulationOnly:true});
  }catch(error){sendError(res,error,"Futures order history could not be loaded.");}
});
app.get("/paper/futures/portfolio",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    const [{data:account,error:accountError},{data:rows,error:positionError}]=await Promise.all([
      userDb.from("paper_accounts").select("cash_paise,reserved_margin_paise,realized_pnl_paise").eq("user_id",user.id).maybeSingle(),
      userDb.from("paper_futures_positions").select("*").eq("user_id",user.id)
    ]);
    if(accountError||!account)return res.status(404).json({error:"Paper Trading account has not been initialized."});
    if(positionError)throw Object.assign(new Error("Futures positions could not be loaded."),{status:503});
    const positions=rows||[];
    if(!positions.length)return res.set("Cache-Control","private, no-store").json({positions:[],cashPaise:account.cash_paise,marketValuePaise:0,unrealizedPnlPaise:0,reservedMarginPaise:account.reserved_margin_paise||0,realizedPnlPaise:account.realized_pnl_paise||0,valuationStatus:"no_open_positions",marginStatus:"none",simulationOnly:true});
    const {token}=await getUpstoxAccessToken(user.id);
    const keys=positions.map(p=>p.instrument_key);
    const quoteResponse=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const quotePayload=await readProviderJson(quoteResponse);
    if(!quoteResponse.ok)return res.status(502).json({error:"Futures portfolio quotes could not be retrieved."});
    const entries=Object.values(quotePayload?.data||{}),now=Date.now();
    let unrealizedPnlPaise=0,stalePositions=0;
    const valued=positions.map(p=>{
      const entry=entries.find(x=>x?.instrument_token===p.instrument_key);
      let q=null;try{q=normalizeProviderQuote(entry,p.instrument_key,{now,maxAgeMs:15000});}catch(_){}
      if(!q){stalePositions++;return {instrumentKey:p.instrument_key,tradingSymbol:p.trading_symbol,netQuantity:p.net_quantity,averagePricePaise:p.average_price_paise,marketPricePaise:null,unrealizedPnlPaise:null,marginReservedPaise:p.reserved_margin_paise,valuationStatus:"stale_or_unavailable"};}
      const pnl=(q.pricePaise-p.average_price_paise)*p.net_quantity;
      unrealizedPnlPaise+=pnl;
      return {instrumentKey:p.instrument_key,tradingSymbol:p.trading_symbol,exchange:p.exchange,expiry:p.expiry,product:p.product,netQuantity:p.net_quantity,averagePricePaise:p.average_price_paise,marketPricePaise:q.pricePaise,unrealizedPnlPaise:pnl,marginReservedPaise:p.reserved_margin_paise,quoteAgeMs:q.quoteAgeMs,valuationStatus:"fresh"};
    });
    res.set("Cache-Control","private, no-store").json({positions:valued,cashPaise:account.cash_paise,marketValuePaise:0,unrealizedPnlPaise,reservedMarginPaise:account.reserved_margin_paise||0,realizedPnlPaise:account.realized_pnl_paise||0,equityPaise:account.cash_paise+unrealizedPnlPaise,valuationStatus:stalePositions?"partial_stale":"fresh",stalePositions,marginStatus:"entry_estimate",simulationOnly:true});
  }catch(error){sendError(res,error,"Futures portfolio could not be loaded.");}
});

// Paper Investing routes were retired under the approved Paper Trading-only product scope.

app.post("/stream",async(req,res)=>{
  let upstream,heartbeat,uid=null,reservation=null,leaseId=null,leaseAcquired=false;
  const lifecycle=createStreamLifecycle(()=>{
    if(heartbeat)heartbeat.stop();
    res.removeListener("drain",onDrain);
    if(uid&&reservation)releaseUserStream(activeUserStreams,uid,reservation);
    if(leaseAcquired&&uid&&leaseId)serviceDb.rpc("release_paper_market_stream_lease",{p_user_id:uid,p_lease_id:leaseId,p_now_ms:Date.now()}).catch(()=>{});
    if(upstream&&upstream.readyState<WebSocket.CLOSING)upstream.close();
  });
  const onDrain=()=>resumeUpstream(upstream,lifecycle.closed);
  const stop=()=>lifecycle.stop();
  const writeEvent=(event,payload)=>{
    if(lifecycle.closed||res.destroyed||res.writableEnded)return false;
    try{return writeSseFrame(res,upstream,formatSseEvent(event,payload));}
    catch(error){if(error.status!==413)throw error;writeSseFrame(res,upstream,formatSseEvent("error",{message:"Market feed frame exceeded the safe size limit."}));stop();if(!res.writableEnded)res.end();return false;}
  };
  res.on("close",stop);
  try{
    const {user}=await auth(req);
    if(lifecycle.closed||res.destroyed||res.writableEnded)return;
    uid=user.id;reservation=reserveUserStream(activeUserStreams,uid);
    if(!reservation)return res.status(429).json({error:"A live market stream is already active for this account."});
    leaseId=crypto.randomUUID();
    const acquired=await serviceDb.rpc("acquire_paper_market_stream_lease",{p_user_id:uid,p_lease_id:leaseId,p_now_ms:Date.now(),p_ttl_ms:30000});
    leaseAcquired=acquired.data===true&&!acquired.error;
    if(!leaseAcquired)return res.status(429).json({error:"A live market stream is already active for this account."});
    if(lifecycle.closed||res.destroyed||res.writableEnded){await serviceDb.rpc("release_paper_market_stream_lease",{p_user_id:uid,p_lease_id:leaseId,p_now_ms:Date.now()}).catch(()=>{});leaseAcquired=false;return;}
    heartbeat=createLeaseHeartbeat({
      renew:async()=>{const result=await serviceDb.rpc("renew_paper_market_stream_lease",{p_user_id:uid,p_lease_id:leaseId,p_now_ms:Date.now(),p_ttl_ms:30000});return !result.error&&result.data===true;},
      onRenewed:()=>{if(res.headersSent&&!lifecycle.closed&&!res.destroyed&&!res.writableEnded)writeSseFrame(res,upstream,formatSseComment("keep-alive"));},
      onLost:()=>{writeEvent("error",{message:"Live market stream lease expired. Reconnect to continue."});if(!res.writableEnded)res.end();stop();},
      onError:()=>{writeEvent("error",{message:"Live market stream lease could not be renewed."});if(!res.writableEnded)res.end();stop();}
    });
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const keys=validateStreamInstrumentKeys(req.body?.instrumentKeys,instrumentCache.map(item=>item.instrument_key),MAX_KEYS);
    const mode=req.body?.mode||"ltpc";
    if(!["ltpc","full","option_greeks"].includes(mode))return res.status(400).json({error:"Unsupported feed mode."});
    const {token}=await getUpstoxAccessToken(uid);
    const authResponse=await fetchProvider("https://api.upstox.com/v3/feed/market-data-feed/authorize",{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const authData=await readProviderJson(authResponse).catch(()=>({}));
    if(!authResponse.ok||!authData?.data?.authorized_redirect_uri)return res.status(502).json({error:"Upstox could not authorize the live market feed."});
    const feedUrl=validateUpstoxFeedUrl(authData.data.authorized_redirect_uri);
    if(res.destroyed||res.writableEnded)return;
    res.status(200).set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.on("drain",onDrain);res.flushHeaders?.();
    writeEvent("status",{connected:false,connecting:true,mode,keys:keys.length});
    upstream=new WebSocket(feedUrl,{followRedirects:false,handshakeTimeout:15000,maxPayload:16*1024*1024,perMessageDeflate:false});
    const acceptOrdered=createMarketFeedEventOrderFilter();
    upstream.on("open",()=>{
      if(lifecycle.closed||res.destroyed||res.writableEnded){stop();return;}
      writeEvent("status",{connected:true,mode,keys:keys.length});
      sendUpstoxSubscription(upstream,{mode,instrumentKeys:keys}).catch(()=>{writeEvent("error",{message:"Market feed subscription could not be sent"});stop();if(!res.writableEnded)res.end();});
    });
    upstream.on("message",(bytes,isBinary)=>{
      if(lifecycle.closed||res.destroyed||res.writableEnded)return;
      if(!isBinary){writeEvent("upstream",{message:String(bytes).slice(0,300)});return;}
      try{
        const decoded=decodeFeedResponse(FeedResponse,bytes);
        const fresh=filterFreshMarketFeeds(decoded,keys);
        const ordered=fresh&&acceptOrdered(fresh);
        if(ordered)writeEvent("market",ordered);
      }catch(_){writeEvent("error",{message:"Market feed decode failed"});}
    });
    upstream.on("error",()=>{writeEvent("error",{message:"Upstream market feed connection failed"});stop();if(!res.writableEnded)res.end();});
    upstream.on("close",()=>{if(!lifecycle.closed){writeEvent("status",{connected:false});stop();if(!res.writableEnded)res.end();}});
  }catch(error){
    if(!res.headersSent)sendError(res,error,"Market feed could not be started.");
    else{writeEvent("error",{message:"Market feed stopped unexpectedly"});if(!res.writableEnded)res.end();}
    stop();
  }
});

async function runPaperLimitWorker({maxOrders=50}={}){
  if(!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>100)throw new TypeError("Paper LIMIT worker batch size is invalid.");
  const leaseToken=crypto.randomUUID(),leaseNow=Date.now();
  const lease=await serviceDb.rpc("acquire_paper_market_worker_lease",{
    p_state_key:"paper_limit_orders",p_lease_token:leaseToken,p_now_ms:leaseNow,p_ttl_ms:240000
  });
  if(lease?.error)throw new Error("Paper LIMIT worker lease could not be acquired.");
  if(lease?.data!==true)return {locked:true,scanned:0,filled:0,notEligible:0,failed:0,alreadyFilled:0};
  const summary={locked:false,scanned:0,filled:0,notEligible:0,failed:0,alreadyFilled:0};
  try{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const stateResult=await serviceDb.from("paper_market_worker_state")
      .select("cursor_created_at,cursor_order_id").eq("state_key","paper_limit_orders").maybeSingle();
    if(stateResult.error)throw new Error("Paper LIMIT worker cursor could not be read.");
    let cursor=normalizeWorkerCursor(stateResult.data);
    const loadBatch=async position=>{
      let query=serviceDb.from("paper_orders")
        .select("order_id,user_id,instrument_key,trading_symbol,exchange,side,product,order_type,status,quantity,limit_price_paise,simulation_only,created_at")
        .eq("order_type","LIMIT").eq("status","PENDING").eq("product","DELIVERY")
        .eq("simulation_only",true).order("created_at",{ascending:true})
        .order("order_id",{ascending:true}).limit(maxOrders);
      if(position.createdAt&&position.orderId)
        query=query.or("created_at.gt."+position.createdAt+",and(created_at.eq."+position.createdAt+",order_id.gt."+position.orderId+")");
      return query;
    };
    let batch=await loadBatch(cursor);
    if(batch.error)throw new Error("Pending Paper LIMIT orders could not be scanned.");
    if(!(batch.data||[]).length&&(cursor.createdAt||cursor.orderId)){
      cursor={createdAt:null,orderId:null};
      const reset=await serviceDb.from("paper_market_worker_state")
        .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()})
        .eq("state_key","paper_limit_orders").eq("lease_token",leaseToken);
      if(reset.error)throw new Error("Paper LIMIT worker cursor could not be reset.");
      batch=await loadBatch(cursor);
      if(batch.error)throw new Error("Pending Paper LIMIT orders could not be rescanned.");
    }
    const orders=batch.data||[];summary.scanned=orders.length;
    const groups=[...groupOrdersByUser(orders).entries()];
    const processUserOrders=async([userId,userOrders])=>{
      try{
        const validOrders=userOrders.filter(order=>{
          const item=instrumentCache.find(x=>x.instrument_key===order.instrument_key);
          return item&&item.instrument_type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(item.segment)
            &&item.exchange===order.exchange&&order.side&&order.product==="DELIVERY";
        });
        if(!validOrders.length){summary.notEligible+=userOrders.length;return;}
        const {token}=await getUpstoxAccessToken(userId);
        const keys=[...new Set(validOrders.map(order=>order.instrument_key))];
        const url="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
        const response=await fetchProvider(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
        const payload=await readProviderJson(response);
        if(!response.ok)throw new Error("Upstox batch quote request failed with status "+response.status);
        const entries=Object.values(payload?.data||{});
        for(const order of validOrders){
          const entry=entries.find(item=>item?.instrument_token===order.instrument_key);
          let quote=null;
          try{quote=normalizeProviderQuote(entry,order.instrument_key,{maxAgeMs:15000});}catch(_){}
          const nowMs=Date.now();
          if(!isEligiblePaperLimitOrder(order,quote,nowMs)){summary.notEligible++;continue;}
          const quoteAgeMs=Math.max(0,nowMs-quote.tradeTimeMs);
          const filled=await serviceDb.rpc("execute_paper_limit_fill",{
            p_order_id:order.order_id,p_execution_price_paise:quote.pricePaise,
            p_quote_timestamp_ms:quote.tradeTimeMs,p_quote_age_ms:quoteAgeMs,p_now_ms:nowMs
          });
          if(filled?.error){
            if(["23514","22023","P0002"].includes(filled.error.code))summary.notEligible++;
            else{summary.failed++;console.warn("Paper LIMIT fill RPC failed",{orderId:order.order_id,code:filled.error.code||"unknown"});}
          }else if(filled?.data?.status==="FILLED"){
            if(filled.data.already_filled)summary.alreadyFilled++;else summary.filled++;
          }else summary.notEligible++;
        }
        summary.notEligible+=userOrders.length-validOrders.length;
      }catch(error){
        summary.failed+=userOrders.length;
        console.warn("Paper LIMIT user batch skipped",{userId,errorName:error?.name||"Error",status:error?.status||500});
      }
    };
    for(let offset=0;offset<groups.length;offset+=5)
      await Promise.all(groups.slice(offset,offset+5).map(processUserOrders));
    if(orders.length){
      const last=orders[orders.length-1];
      const saved=await serviceDb.from("paper_market_worker_state")
        .update({cursor_created_at:last.created_at,cursor_order_id:last.order_id,updated_at:new Date().toISOString()})
        .eq("state_key","paper_limit_orders").eq("lease_token",leaseToken);
      if(saved.error)throw new Error("Paper LIMIT worker cursor could not be saved.");
    }else{
      const saved=await serviceDb.from("paper_market_worker_state")
        .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()})
        .eq("state_key","paper_limit_orders").eq("lease_token",leaseToken);
      if(saved.error)throw new Error("Paper LIMIT worker cursor could not be reset.");
    }
    return summary;
  }finally{
    const released=await serviceDb.rpc("release_paper_market_worker_lease",{
      p_state_key:"paper_limit_orders",p_lease_token:leaseToken,p_now_ms:Date.now()
    });
    if(released?.error)console.warn("Paper LIMIT worker lease release failed",{code:released.error.code||"unknown"});
  }
}

async function runPaperProtectiveWorker({maxOrders=20}={}){
  if(!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>50)throw new TypeError("Protective worker batch size is invalid.");
  const leaseToken=crypto.randomUUID();
  const lease=await serviceDb.rpc("acquire_paper_market_worker_lease",{
    p_state_key:"paper_protective_orders",p_lease_token:leaseToken,p_now_ms:Date.now(),p_ttl_ms:240000
  });
  if(lease?.error)throw new Error("Protective worker lease could not be acquired.");
  if(lease?.data!==true)return {locked:true,scanned:0,filled:0,notEligible:0,failed:0};
  const summary={locked:false,scanned:0,filled:0,notEligible:0,failed:0};
  try{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const batch=await serviceDb.from("paper_protective_orders")
      .select("order_id,user_id,asset_class,instrument_key,product,side,trigger_type,trigger_direction,trigger_price_paise,quantity,status,created_at")
      .eq("status","ACTIVE").eq("asset_class","EQUITY").eq("side","SELL")
      .in("product",["DELIVERY","INTRADAY"])
      .order("worker_checked_at",{ascending:true,nullsFirst:true})
      .order("created_at",{ascending:true}).limit(maxOrders);
    if(batch.error)throw new Error("Active equity protective orders could not be scanned.");
    const orders=batch.data||[];summary.scanned=orders.length;
    const groups=[...groupOrdersByUser(orders).entries()];
    const processUserOrders=async([userId,userOrders])=>{
      try{
        const validOrders=userOrders.filter(order=>{
          const instrument=instrumentCache.find(x=>x.instrument_key===order.instrument_key);
          return isSupportedProtectiveOrder(order)&&instrument&&instrument.instrument_type==="EQ"
            &&["NSE_EQ","BSE_EQ"].includes(instrument.segment)
            &&(order.product==="DELIVERY"||order.product==="INTRADAY");
        });
        summary.notEligible+=userOrders.length-validOrders.length;
        if(!validOrders.length)return;
        const {token}=await getUpstoxAccessToken(userId);
        const keys=[...new Set(validOrders.map(order=>order.instrument_key))];
        const response=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),
          {headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
        const payload=await readProviderJson(response);
        if(!response.ok)throw new Error("Upstox protective quote request failed with status "+response.status);
        const entries=Object.values(payload?.data||{}),now=Date.now();
        const positionsResult=await serviceDb.from("paper_equity_positions")
          .select("instrument_key,product,quantity,reserved_quantity")
          .eq("user_id",userId);
        if(positionsResult.error)throw new Error("Equity positions for protective orders could not be read.");
        const positions=positionsResult.data||[];
        for(const order of validOrders){
          const entry=entries.find(item=>item?.instrument_token===order.instrument_key);
          let quote=null;
          try{const normalized=normalizeProviderQuote(entry,order.instrument_key,{now,maxAgeMs:15000});
            quote={instrumentKey:order.instrument_key,pricePaise:normalized.pricePaise,tradeTimeMs:normalized.tradeTimeMs};
          }catch(_){}
          const evaluated=await serviceDb.from("paper_protective_orders")
            .update({worker_checked_at:new Date(now).toISOString(),...(quote?{last_evaluated_quote_at_ms:quote.tradeTimeMs}:{})})
            .eq("order_id",order.order_id).eq("status","ACTIVE");
          if(evaluated.error){summary.failed++;continue;}
          if(!quote){summary.notEligible++;continue;}
          if(!evaluateProtectiveOrder(order,quote,now)){summary.notEligible++;continue;}
          const position=positions.find(p=>p.instrument_key===order.instrument_key&&p.product===order.product);
          if(!isPositionCloseable(order,position)){summary.notEligible++;continue;}
          const executionOrderId=crypto.createHash("sha256").update("zenura-protective-fill:"+order.order_id+":"+quote.tradeTimeMs+":"+quote.pricePaise).digest("hex");
          const fingerprint=crypto.createHash("sha256").update(JSON.stringify({orderId:order.order_id,instrumentKey:order.instrument_key,
            product:order.product,side:order.side,quantity:order.quantity,triggerType:order.trigger_type,
            triggerDirection:order.trigger_direction,triggerPricePaise:order.trigger_price_paise,
            quoteTimestampMs:quote.tradeTimeMs,executionPricePaise:quote.pricePaise})).digest("hex");
          const fill=await serviceDb.rpc("execute_paper_equity_protective_fill",{
            p_protective_order_id:order.order_id,p_execution_order_id:executionOrderId,
            p_request_fingerprint:fingerprint,p_execution_price_paise:quote.pricePaise,
            p_quote_timestamp_ms:quote.tradeTimeMs,p_now_ms:Date.now()
          });
          if(fill?.error){
            if(["23514","22023","P0002"].includes(fill.error.code))summary.notEligible++;
            else{summary.failed++;console.warn("Equity protective fill RPC failed",{orderId:order.order_id,code:fill.error.code||"unknown"});}
          }else if(fill?.data?.status==="FILLED")summary.filled++;
          else summary.notEligible++;
        }
      }catch(error){
        summary.failed+=userOrders.length;
        const checkedAt=new Date().toISOString();
        for(const order of userOrders){
          const marked=await serviceDb.from("paper_protective_orders")
            .update({worker_checked_at:checkedAt})
            .eq("order_id",order.order_id).eq("status","ACTIVE");
          if(marked.error)summary.failed++;
        }
        console.warn("Protective user batch skipped",{userId,errorName:error?.name||"Error",status:error?.status||500});
      }
    };
    for(let offset=0;offset<groups.length;offset+=3)
      await Promise.all(groups.slice(offset,offset+3).map(processUserOrders));
    return summary;
  }finally{
    const released=await serviceDb.rpc("release_paper_market_worker_lease",{
      p_state_key:"paper_protective_orders",p_lease_token:leaseToken,p_now_ms:Date.now()
    });
    if(released?.error)console.warn("Protective worker lease release failed",{code:released.error.code||"unknown"});
  }
}

async function start(){
  if(!ENC_KEY||!UPSTOX_CLIENT_ID||!UPSTOX_CLIENT_SECRET||!UPSTOX_REDIRECT_URI){
    throw new Error("Supabase gateway secrets and Upstox OAuth configuration are required.");
  }
  const callbackUrl=new URL(UPSTOX_REDIRECT_URI),appUrl=new URL(APP_REDIRECT_URI);
  if(callbackUrl.protocol!=="https:"||!callbackUrl.pathname.endsWith("/upstox/oauth/callback")
     ||appUrl.protocol!=="https:"||callbackUrl.username||callbackUrl.password||appUrl.username||appUrl.password
     ||callbackUrl.search||callbackUrl.hash||appUrl.search||appUrl.hash){
    throw new Error("Upstox callback and app redirect must be clean HTTPS URLs.");
  }
  if(!ALLOWED_ORIGINS.length||ALLOWED_ORIGINS.some(origin=>{try{const u=new URL(origin);return u.origin!==origin||u.protocol!=="https:"||u.pathname!=="/"||u.search||u.hash;}catch(_){return true;}})
     ||!ALLOWED_ORIGINS.includes(appUrl.origin)){
    throw new Error("ALLOWED_ORIGINS must contain the exact HTTPS origin of ZENURA_APP_REDIRECT_URI.");
  }
  await loadProto();
  app.listen(PORT,"0.0.0.0",()=>console.log("Supabase-native ZENURA market gateway listening on",PORT));
  refreshInstrumentCache().catch(error=>console.error("Initial instrument refresh failed:",error.message));
  if(process.env.PAPER_PROTECTIVE_WORKER_ENABLED==="true"){
    const intervalMs=Math.max(2000,Math.min(15000,Number(process.env.PAPER_PROTECTIVE_WORKER_INTERVAL_MS)||5000));
    paperProtectiveWorkerStatus.enabled=true;paperProtectiveWorkerStatus.intervalMs=intervalMs;
    let workerBusy=false,nextWorkerRunAt=0,backoffMs=intervalMs;
    const runWorker=async()=>{
      if(workerBusy||Date.now()<nextWorkerRunAt)return;
      workerBusy=true;
      try{
        const result=await runPaperProtectiveWorker({maxOrders:20});
        paperProtectiveWorkerStatus.lastRunAt=Date.now();
        paperProtectiveWorkerStatus.lastCycle={scanned:result.scanned,filled:result.filled,notEligible:result.notEligible,failed:result.failed,locked:result.locked,cycleError:false};
        backoffMs=intervalMs;nextWorkerRunAt=Date.now()+intervalMs;
        if(result.filled||result.failed)console.log("Paper protective worker cycle",JSON.stringify(result));
      }catch(error){
        paperProtectiveWorkerStatus.lastRunAt=Date.now();
        paperProtectiveWorkerStatus.lastCycle={scanned:0,filled:0,notEligible:0,failed:1,locked:false,cycleError:true};
        nextWorkerRunAt=Date.now()+backoffMs;backoffMs=Math.min(60000,backoffMs*2);
        console.error("Paper protective worker cycle failed:",error.message);
      }finally{workerBusy=false;}
    };
    runWorker().catch(()=>{});const timer=setInterval(runWorker,intervalMs);timer.unref?.();
    console.log("Paper equity protective worker enabled; interval",intervalMs,"ms");
  }
  if(process.env.PAPER_LIMIT_WORKER_ENABLED==="true"){
    const intervalMs=Math.max(1000,Math.min(10000,Number(process.env.PAPER_LIMIT_WORKER_INTERVAL_MS)||2000));
    paperLimitWorkerStatus.enabled=true;
    paperLimitWorkerStatus.intervalMs=intervalMs;
    let workerBusy=false,nextWorkerRunAt=0,workerBackoffMs=intervalMs;
    const runWorker=async()=>{
      if(workerBusy||Date.now()<nextWorkerRunAt)return;
      workerBusy=true;
      try{
        const result=await runPaperLimitWorker({maxOrders:10});
        paperLimitWorkerStatus.lastRunAt=Date.now();
        paperLimitWorkerStatus.lastCycle={scanned:result.scanned,filled:result.filled,failed:result.failed,locked:result.locked,cycleError:false};
        workerBackoffMs=intervalMs;nextWorkerRunAt=Date.now()+intervalMs;
        if(result.filled||result.failed)console.log("Paper LIMIT worker cycle",JSON.stringify(result));
      }catch(error){
        paperLimitWorkerStatus.lastRunAt=Date.now();
        paperLimitWorkerStatus.lastCycle={scanned:0,filled:0,failed:1,locked:false,cycleError:true};
        nextWorkerRunAt=Date.now()+workerBackoffMs;
        workerBackoffMs=Math.min(30000,workerBackoffMs*2);
        console.error("Paper LIMIT worker cycle failed:",error.message);
      }finally{workerBusy=false;}
    };
    runWorker().catch(()=>{});
    const workerTimer=setInterval(runWorker,intervalMs);
    workerTimer.unref?.();
    console.log("Paper LIMIT worker enabled; interval",intervalMs,"ms");
  }
}
if(require.main===module)start().catch(error=>{console.error("Supabase gateway startup failed:",error.message);process.exit(1);});
module.exports={app,start,runPaperLimitWorker,runPaperProtectiveWorker};
