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
const {createPaperProtectiveWorker}=require("./lib/paper-protective-worker");
const {createPaperIntradayLimitWorker}=require("./lib/paper-intraday-limit-worker");
const {createPaperFuturesLimitWorker,isVerifiedSessionOpen}=require("./lib/paper-futures-limit-worker");
const {createPaperOptionLimitWorker}=require("./lib/paper-option-limit-worker");
const {loadVerifiedExchangeSession}=require("./lib/exchange-session-calendar");
const {buildPortfolioValuation}=require("./lib/paper-portfolio-valuation");
const {calculateDerivativePortfolio}=require("./lib/derivative-portfolio");
const {validateDerivativeContract,normalizeTickSizePaise}=require("./lib/derivative-contract");
const {validateOptionLimitOrder,evaluateOptionLimitQuote}=require("./lib/option-limit-policy");
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
const {upstoxHttpError}=require("./lib/upstox-http-policy");
const {getUpstoxUserCooldown,recordUpstoxUserFailure,clearUpstoxUserCooldown}=require("./lib/upstox-user-cooldown");
const {MAX_RECONNECT_ATTEMPTS,reconnectDelayMs}=require("./lib/stream-reconnect-policy");
const {decryptUpstoxToken,encryptUpstoxToken}=require("./lib/upstox-token-crypto");
const {isUpstoxAccessTokenUsable}=require("./lib/upstox-token-validity");
const {readUserUpstoxConnection}=require("./lib/upstox-user-connection");
const {revokeUpstoxAccessToken}=require("./lib/upstox-revocation");
const {nextUpstoxTokenExpiry}=require("../functions/lib/upstox-token-expiry");
const {isUsableUpstoxTokenResponse}=require("../functions/lib/upstox-token-response");
const {isUsableUpstoxOAuthCallback}=require("../functions/lib/upstox-oauth-callback-input");
const {validateHttpsRedirectUri}=require("./lib/redirect-uri-policy");
const {apiRateLimitBucket,consumeApiRateLimit}=require("./lib/api-rate-limit");
const {encodePaperOrderCursor,decodePaperOrderCursor,paperOrderCursorFilter}=require("./lib/paper-order-cursor");

const PORT=Number(process.env.PORT||8080);
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY=process.env.UPSTOX_TOKEN_ENCRYPTION_KEY;
const UPSTOX_CLIENT_ID=process.env.UPSTOX_CLIENT_ID;
const UPSTOX_CLIENT_SECRET=process.env.UPSTOX_CLIENT_SECRET;
const UPSTOX_REDIRECT_URI=process.env.UPSTOX_REDIRECT_URI;
const APP_REDIRECT_URI=process.env.ZENURA_APP_REDIRECT_URI||"https://zenuraignite.com/markets/stocks/";
const VALID_UPSTOX_REDIRECT_URI=validateHttpsRedirectUri(UPSTOX_REDIRECT_URI);
const VALID_APP_REDIRECT_URI=validateHttpsRedirectUri(APP_REDIRECT_URI);
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
const paperIntradayLimitWorkerStatus={enabled:false,intervalMs:null,lastRunAt:null,lastCycle:null};
const paperFuturesLimitWorkerStatus={enabled:false,intervalMs:null,lastRunAt:null,lastCycle:null};
const paperOptionLimitWorkerStatus={enabled:false,intervalMs:null,lastRunAt:null,lastCycle:null};
const activeUserStreams=new Map();
function fetchProvider(url,options={},timeoutMs=15000){return fetchProviderWithTimeout(fetch,url,options,timeoutMs);}
function errorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.name==="TimeoutError"||error?.name==="AbortError")return 504;
  return 500;
}
function sendError(res,error,fallback){
  if(res.headersSent)return;
  if(Number.isInteger(error?.retryAfterSeconds))res.set("Retry-After",String(error.retryAfterSeconds));
  const body={error:error.status?error.message:fallback};
  if(typeof error?.code==="string")body.code=error.code;
  res.status(errorStatus(error)).json(body);
}
function decryptToken(box){return decryptUpstoxToken(box,ENC_KEY);}
async function auth(req){
  const accessToken=readBearerToken(req);
  const user=await runtime.authenticateRequest(req);
  const bucket=apiRateLimitBucket(req.method,req.path);
  if(bucket){
    const rate=await consumeApiRateLimit(serviceDb,user.id,bucket);
    if(!rate.allowed){
      throw Object.assign(new Error("Too many requests. Please wait before trying again."),{
        status:429,retryAfterSeconds:rate.retryAfterSeconds
      });
    }
  }
  return {user,accessToken,userDb:runtime.createUserClient(accessToken)};
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
  const {data,error}=await readUserUpstoxConnection(serviceDb,userId);
  if(error)throw Object.assign(new Error("Upstox connection status could not be read"),{status:503});
  if(!data)return null;
  return {...data,tokenCiphertext:data.token_ciphertext,expiresAtMs:Date.parse(data.token_expires_at)};
}
function connectionUsable(connection){
  return !!connection&&connection.status==="connected"
    &&isUpstoxAccessTokenUsable(connection.expiresAtMs,Date.now())
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
  if(!response.ok)throw upstoxHttpError(response);
  const payload=await readProviderJson(response);
  const quote=Object.values(payload?.data||{}).find(x=>x&&x.instrument_token===instrumentKey);
  return {quote,payload};
}
app.get("/health",(_req,res)=>res.json({
  ok:true,service:"zenura-supabase-market-gateway",authProvider:"supabase",
  feedProtocol:"upstox-v3",instrumentMasterLoaded:instrumentCache.length>0,
  instrumentMasterUpdatedAt:instrumentCacheUpdatedAt||null,
  limitWorker:{...paperLimitWorkerStatus},intradayLimitWorker:{...paperIntradayLimitWorkerStatus},futuresLimitSubmissionEnabled:process.env.PAPER_FUTURES_LIMIT_ENABLED==="true",futuresLimitWorker:{...paperFuturesLimitWorkerStatus},optionsLimitSubmissionEnabled:process.env.PAPER_OPTIONS_LIMIT_ENABLED==="true",optionsLimitWorker:{...paperOptionLimitWorkerStatus},protectiveWorker:{...paperProtectiveWorkerStatus}
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
    if(!UPSTOX_CLIENT_ID||!VALID_UPSTOX_REDIRECT_URI||!VALID_APP_REDIRECT_URI)return res.status(503).json({error:"Upstox OAuth server configuration is incomplete or invalid."});
    const state=crypto.randomBytes(32).toString("hex"),stateHash=crypto.createHash("sha256").update(state).digest("hex");
    const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
    const {error}=await serviceDb.rpc("begin_upstox_oauth",{
      p_user_id:user.id,p_state_hash:stateHash,p_expires_at:expiresAt,p_now_ms:Date.now()
    });
    if(error)throw Object.assign(new Error("Secure Upstox authorization could not be started."),{status:503});
    const params=new URLSearchParams({client_id:UPSTOX_CLIENT_ID,redirect_uri:VALID_UPSTOX_REDIRECT_URI,response_type:"code",state});
    res.set("Cache-Control","no-store");
    res.json({authorizationUrl:"https://api.upstox.com/v2/login/authorization/dialog?"+params.toString()});
  }catch(error){sendError(res,error,"Upstox authorization could not be started.");}
});
app.get("/upstox/oauth/callback",async(req,res)=>{
  const finish=(status)=>{
    res.set({"Cache-Control":"no-store","Pragma":"no-cache","Referrer-Policy":"no-referrer"});
    const target=new URL(VALID_APP_REDIRECT_URI||"https://zenuraignite.com/markets/stocks/");target.searchParams.set("upstox",status);res.redirect(303,target.toString());
  };
  try{
    const {code,state}=req.query;
    if(!isUsableUpstoxOAuthCallback(code,state))return finish("error");
    if(!UPSTOX_CLIENT_ID||!UPSTOX_CLIENT_SECRET||!VALID_UPSTOX_REDIRECT_URI||!VALID_APP_REDIRECT_URI||!ENC_KEY)return finish("error");
    const stateHash=crypto.createHash("sha256").update(state).digest("hex");
    const {data:stateData,error:stateError}=await serviceDb.rpc("consume_upstox_oauth_state",{p_state_hash:stateHash,p_now_ms:Date.now()});
    if(stateError||!stateData?.user_id)return finish("error");
    const tokenResponse=await fetchProvider("https://api.upstox.com/v2/login/authorization/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
      body:new URLSearchParams({code,client_id:UPSTOX_CLIENT_ID,client_secret:UPSTOX_CLIENT_SECRET,redirect_uri:VALID_UPSTOX_REDIRECT_URI,grant_type:"authorization_code"})
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
    // Capture the current token in memory only. Local disconnection is committed
    // first so provider logout failure can never leave this app using the token.
    let providerToken=null;
    try{
      const connection=await getConnection(user.id);
      if(connection&&connection.status==="connected"
        &&Number.isFinite(connection.expiresAtMs)&&connection.expiresAtMs>Date.now()
        &&connection.tokenCiphertext&&typeof connection.tokenCiphertext==="object"){
        providerToken=decryptToken(connection.tokenCiphertext);
      }
    }catch(_error){providerToken=null;}
    const {data,error}=await serviceDb.rpc("disconnect_upstox_connection",{p_user_id:user.id,p_now_ms:Date.now()});
    if(error)throw Object.assign(new Error("Upstox connection could not be safely revoked."),{status:503});
    const providerRevoked=providerToken
      ?await revokeUpstoxAccessToken(providerToken,{fetchProvider,readProviderJson})
      :null;
    res.set("Cache-Control","no-store").json({
      disconnected:true,generation:data,feedReady:false,
      providerRevocation:providerRevoked===true?"confirmed":providerRevoked===false?"unconfirmed":"not_attempted"
    });
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
    if(!upstream.ok)throw upstoxHttpError(upstream);
    const payload=await readProviderJson(upstream);
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
    if(!upstream.ok)throw upstoxHttpError(upstream);
    const payload=await readProviderJson(upstream);
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
    if(orderType==="LIMIT"&&product==="INTRADAY"&&!paperIntradayLimitWorkerStatus.enabled)return res.status(503).json({error:"Intraday LIMIT execution worker is not enabled on this gateway yet."});
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
      const rpcName=product==="INTRADAY"?"submit_paper_intraday_limit_order":"submit_paper_limit_order";
      const rpcArgs=product==="INTRADAY"?{
        p_user_id:user.id,p_order_id:orderId,p_idempotency_key:idempotencyKey,
        p_request_fingerprint:requestFingerprint,p_instrument_key:instrumentKey,
        p_trading_symbol:instrument.trading_symbol||instrument.name,p_exchange:instrument.exchange,
        p_side:side,p_quantity:quantity,p_limit_price_paise:limitPricePaise
      }:{
        p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:requestFingerprint,
        p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol||instrument.name,
        p_exchange:instrument.exchange,p_side:side,p_quantity:quantity,p_limit_price_paise:limitPricePaise
      };
      const result=await runtime.callUserRpc(user,rpcName,rpcArgs);
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
      chargesPaise:result?.charges_paise??0,chargesBreakdown:result?.charges_breakdown??{},
      cashDeltaPaise:result?.cash_delta_paise??null,cashPaise:result?.cash_paise??null,
      realizedPnlPaise:result?.order_realized_pnl_paise??0,
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Paper order could not be completed.");}
});
app.post("/paper/orders/:orderId/cancel",async(req,res)=>{
  try{
    const {user}=await auth(req),orderId=String(req.params.orderId||"");
    if(!/^[a-f0-9]{64}$/.test(orderId))return res.status(400).json({error:"Invalid paper order id."});
    const {data:order,error:orderError}=await userDb.from("paper_orders")
      .select("product,order_type").eq("user_id",user.id).eq("order_id",orderId).maybeSingle();
    if(orderError)throw Object.assign(new Error("Order ownership and product could not be verified."),{status:503});
    if(!order||order.order_type!=="LIMIT")return res.status(404).json({error:"Pending LIMIT order was not found."});
    const result=order.product==="INTRADAY"
      ?await runtime.callUserRpc(user,"cancel_paper_intraday_limit_order",{p_user_id:user.id,p_order_id:orderId})
      :await runtime.callUserRpc(user,"cancel_paper_limit_order",{p_order_id:orderId});
    res.set("Cache-Control","private, no-store").json({orderId,status:result?.status||"CANCELLED",
      cashPaise:result?.cash_paise??null,reservedCashPaise:result?.reserved_cash_paise??null,
      product:order.product,simulationOnly:true});
  }catch(error){sendError(res,error,"LIMIT order cancellation failed.");}
});
app.post("/paper/protective-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    if(!paperProtectiveWorkerStatus.enabled)return res.status(503).json({error:"Protective execution is not enabled on this gateway yet."});
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
app.put("/paper/protective-orders/:orderId",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),orderId=String(req.params.orderId||"");
    const triggerType=String(req.body?.trigger_type||"").toUpperCase();
    const triggerPricePaise=Number(req.body?.trigger_price_paise),quantity=Number(req.body?.quantity);
    if(!isUuid(orderId)
       ||!["STOP_LOSS","TARGET"].includes(triggerType)
       ||!Number.isSafeInteger(triggerPricePaise)||triggerPricePaise<1
       ||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)
      return res.status(400).json({error:"Invalid protective order modification details."});
    const {data,error}=await userDb.rpc("modify_paper_equity_protective_order",{
      p_protective_order_id:orderId,p_user_id:user.id,p_trigger_type:triggerType,
      p_trigger_price_paise:triggerPricePaise,p_quantity:quantity
    });
    if(error)throw Object.assign(new Error("Protective order could not be modified."),{status:409});
    const order=data?.order||{};
    res.set("Cache-Control","private, no-store").json({
      orderId:order.order_id||orderId,triggerType:order.trigger_type||triggerType,
      triggerDirection:order.trigger_direction,triggerPricePaise:order.trigger_price_paise??triggerPricePaise,
      quantity:order.quantity??quantity,status:order.status||"UNKNOWN",
      idempotentReplay:data?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Protective order modification failed.");}
});
app.get("/paper/protective-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Protective order limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_protective_orders").select("order_id,instrument_key,product,side,trigger_type,trigger_direction,trigger_price_paise,quantity,status,created_at,filled_at,cancelled_at,execution_price_paise")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Protective order history could not be loaded."),{status:503});
    const orders=(data||[]).map(order=>({orderId:order.order_id,instrumentKey:order.instrument_key,product:order.product,
      side:order.side,triggerType:order.trigger_type,triggerDirection:order.trigger_direction,
      triggerPricePaise:order.trigger_price_paise,quantity:order.quantity,status:order.status,
      executionPricePaise:order.execution_price_paise,createdAt:order.created_at,
      filledAt:order.filled_at,cancelledAt:order.cancelled_at,simulationOnly:true}));
    res.set("Cache-Control","private, no-store").json({orders,workerEnabled:paperProtectiveWorkerStatus.enabled,simulationOnly:true});
  }catch(error){sendError(res,error,"Protective order history could not be loaded.");}
});
app.post("/paper/protective-orders/:orderId/cancel",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),orderId=String(req.params.orderId||"");
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
    let cursor=null;
    if(req.query.cursor!==undefined){
      try{cursor=decodePaperOrderCursor(String(req.query.cursor));}
      catch(_){return res.status(400).json({error:"Order history cursor is invalid."});}
    }
    let query=userDb.from("paper_orders").select("*").eq("user_id",user.id);
    if(cursor)query=query.or(paperOrderCursorFilter(cursor));
    const {data,error}=await query.order("created_at",{ascending:false}).order("order_id",{ascending:false}).limit(limit+1);
    if(error)throw Object.assign(new Error("Paper order history could not be loaded."),{status:503});
    const rows=data||[],hasMore=rows.length>limit,page=rows.slice(0,limit);
    const orders=page.map(o=>({id:o.order_id,tradingSymbol:o.trading_symbol,exchange:o.exchange,side:o.side,quantity:o.quantity,product:o.product,executionPricePaise:o.execution_price_paise,limitPricePaise:o.limit_price_paise,grossPaise:o.gross_paise,chargesPaise:o.charges_paise??0,chargesBreakdown:o.charges_breakdown??{},cashDeltaPaise:o.cash_delta_paise??null,realizedPnlPaise:o.realized_pnl_paise,orderType:o.order_type,status:o.status,simulationOnly:true,createdAt:o.created_at?Date.parse(o.created_at):null}));
    const nextCursor=hasMore&&page.length?encodePaperOrderCursor(page[page.length-1]):null;
    res.set("Cache-Control","private, no-store").json({orders,hasMore,nextCursor,simulationOnly:true});
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
    if(!response.ok)throw upstoxHttpError(response);
    const valuation=buildPortfolioValuation({positions,quotes:Object.values(payload?.data||{}),cashPaise:account.cash_paise,realizedPnlPaise:realized,instruments:instrumentCache,now:Date.now(),maxAgeMs:60000});
    res.set("Cache-Control","private, no-store").json({...valuation,product});
  }catch(error){sendError(res,error,"Portfolio valuation could not be loaded.");}
});
app.post("/paper/derivative/margin-preview",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),{instrumentKey,lots,side,product}=parseMarginPreviewInput(req.body);
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="FUT"&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE futures contract from the official instrument master."});
    // Reject invalid instruments before consuming provider credentials; rate-limit
    // authenticated previews before any broker/network request.
    const rate=await serviceDb.rpc("consume_paper_margin_preview_slot",{p_user_id:user.id,p_now_ms:Date.now(),p_min_interval_ms:5000});
    if(rate.error||rate.data!==true)return res.status(429).set("Retry-After","5").json({error:"Please wait before requesting another broker margin preview."});
    const {token}=await getUpstoxAccessToken(user.id);
    const {quote}=await getQuote(token,instrumentKey),normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
    const upstream=await fetchProvider("https://api.upstox.com/v2/charges/margin",{
      method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
      body:JSON.stringify({instruments:[{instrument_key:instrumentKey,quantity:contract.quantity,product,transaction_type:side,price:normalized.pricePaise/100}]})
    });
    const payload=await readProviderJson(upstream);
    if(!upstream.ok)throw upstoxHttpError(upstream);
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
app.post("/paper/derivative/limit-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req);
    if(process.env.PAPER_OPTIONS_LIMIT_ENABLED!=="true"
       ||process.env.PAPER_OPTIONS_LIMIT_WORKER_ENABLED!=="true"
       ||!paperOptionLimitWorkerStatus.enabled){
      return res.status(503).json({error:"NSE Options LIMIT is not enabled on this gateway.",executionEnabled:false});
    }
    const instrumentKey=String(req.body?.instrument_key||"");
    const lots=Number(req.body?.lots),side=String(req.body?.side||"").toUpperCase();
    const idempotencyKey=String(req.body?.idempotency_key||"");
    const limitPricePaise=Number(req.body?.limit_price_paise);
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!instrumentKey||instrumentKey.length>160||/[\r\n]/.test(instrumentKey))
      return res.status(400).json({error:"A valid NSE option instrument_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Options LIMIT side must be BUY or SELL."});
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000)
      return res.status(400).json({error:"Lots must be a whole number between 1 and 10,000."});
    if(!Number.isSafeInteger(limitPricePaise)||limitPricePaise<1)
      return res.status(400).json({error:"LIMIT price must be a positive integer number of paise."});
    const orderId=makeOrderId(user.id,idempotencyKey);
    const fingerprint=makeOrderFingerprint({instrumentKey,side,lots,orderType:"LIMIT",limitPricePaise});
    // Resolve an identical retry before checking today's session, quote or expiry.
    // This lets users safely recover a response even after the order's session ends.
    const {data:prior,error:priorError}=await userDb.from("paper_option_limit_orders")
      .select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(priorError)throw Object.assign(new Error("Options LIMIT idempotency state could not be checked."),{status:503});
    if(prior){
      if(prior.order_id!==orderId||prior.request_fingerprint!==fingerprint)
        return res.status(409).json({error:"Options LIMIT idempotency key was reused with different order details."});
      return res.set("Cache-Control","private, no-store").json({
        orderId:prior.order_id,tradingSymbol:prior.trading_symbol,instrumentKey:prior.instrument_key,
        side:prior.side,quantity:prior.quantity,filledQuantity:prior.filled_quantity,
        remainingQuantity:prior.remaining_quantity,limitPricePaise:prior.limit_price_paise,
        reservedCashPaise:prior.reserved_cash_paise,reservedCloseQuantity:prior.reserved_close_quantity,
        status:prior.status,idempotentReplay:true,simulationOnly:true
      });
    }
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey
      &&x.exchange==="NSE"&&x.segment==="NSE_FO"&&["CE","PE"].includes(x.instrument_type));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE CE/PE contract from the official instrument master."});
    const nowMs=Date.now();
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:limitPricePaise,now:nowMs});
    const {data:account,error:accountError}=await userDb.from("paper_accounts")
      .select("cash_paise,reserved_cash_paise,reserved_margin_paise")
      .eq("user_id",user.id).maybeSingle();
    if(accountError||!account)return res.status(409).json({error:"Initialize your Indian Paper Trading account first."});
    let availableLongQuantity=0,reservedCloseQuantity=0;
    if(side==="SELL"){
      const {data:position,error:positionError}=await userDb.from("paper_derivative_positions")
        .select("net_quantity,reserved_quantity").eq("user_id",user.id)
        .eq("instrument_key",instrumentKey).maybeSingle();
      if(positionError)throw Object.assign(new Error("Option position reservation could not be checked."),{status:503});
      if(!position)return res.status(409).json({error:"SELL LIMIT can only close an existing long option position."});
      availableLongQuantity=position.net_quantity;
      reservedCloseQuantity=position.reserved_quantity||0;
    }
    const order=validateOptionLimitOrder({
      instrument,side,lots,limitPricePaise,
      availableCashPaise:availablePaperCash(account),
      availableLongQuantity,reservedCloseQuantity,nowMs
    });
    const {token}=await getUpstoxAccessToken(user.id);
    const {payload:quotePayload}=await getQuote(token,instrumentKey);
    const quoteLimitPricePaise=side==="BUY"
      ?Number.MAX_SAFE_INTEGER-(Number.MAX_SAFE_INTEGER%order.tickSizePaise)
      :order.tickSizePaise;
    const quoteSnapshot=evaluateOptionLimitQuote(quotePayload,instrument,{
      side,limitPricePaise:quoteLimitPricePaise,remainingQuantity:1,
      tickSizePaise:order.tickSizePaise
    },{nowMs,maxAgeMs:15000});
    if(!quoteSnapshot.eligible)
      return res.status(409).json({error:"A fresh, valid NSE executable-depth quote is required to submit an Options LIMIT order."});
    const session=await loadVerifiedExchangeSession(serviceDb,"NSE",nowMs);
    if(!isVerifiedSessionOpen(nowMs,session))
      return res.status(409).json({error:"A verified open NSE session is required to submit an Options LIMIT order."});
    const sessionStartMs=Date.parse(session.sessionDate+"T00:00:00+05:30");
    const expiresAt=new Date(sessionStartMs+session.closeMinute*60000).toISOString();
    if(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=nowMs)
      return res.status(409).json({error:"Verified NSE session close is invalid for this Options LIMIT order."});
    const result=await runtime.callUserRpc(user,"submit_paper_option_limit_order",{
      p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:fingerprint,
      p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol,
      p_exchange:"NSE",p_segment:"NSE_FO",p_instrument_type:instrument.instrument_type,
      p_expiry:order.expiry,p_strike_price:instrument.strike_price,
      p_lot_size:order.lotSize,p_tick_size_paise:order.tickSizePaise,
      p_side:side,p_quantity:order.quantity,p_limit_price_paise:limitPricePaise,
      p_now_ms:nowMs,p_expires_at:expiresAt
    });
    res.set("Cache-Control","private, no-store").status(result?.idempotent_replay?200:201).json({
      orderId:result?.order_id||orderId,tradingSymbol:instrument.trading_symbol,
      instrumentKey,side,quantity:order.quantity,lots,limitPricePaise,
      reservedCashPaise:result?.reserved_cash_paise??order.reservedCashPaise,
      reservedCloseQuantity:result?.reserved_close_quantity??order.reservedCloseQuantity,
      status:result?.status||"PENDING",idempotentReplay:result?.idempotent_replay===true,
      simulationOnly:true
    });
  }catch(error){sendError(res,error,"NSE Options LIMIT order could not be submitted.");}
});
app.get("/paper/derivative/limit-orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Options LIMIT history limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_option_limit_orders").select("*")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Options LIMIT order history could not be loaded."),{status:503});
    const orders=data||[],ids=orders.map(o=>o.order_id);
    let fills=[];
    if(ids.length){
      const result=await userDb.from("paper_option_limit_fills").select("*").in("order_id",ids)
        .order("created_at",{ascending:true}).order("fill_sequence",{ascending:true});
      if(result.error)throw Object.assign(new Error("Options LIMIT fills could not be loaded."),{status:503});
      fills=result.data||[];
    }
    res.set("Cache-Control","private, no-store").json({
      orders:orders.map(o=>({
        id:o.order_id,tradingSymbol:o.trading_symbol,instrumentKey:o.instrument_key,
        instrumentType:o.instrument_type,expiry:o.expiry,strikePrice:o.strike_price,
        side:o.side,quantity:o.quantity,lotSize:o.lot_size,filledQuantity:o.filled_quantity,
        remainingQuantity:o.remaining_quantity,limitPricePaise:o.limit_price_paise,
        averageFillPricePaise:o.average_fill_price_paise,
        reservedCashPaise:o.reserved_cash_paise,reservedCloseQuantity:o.reserved_close_quantity,
        cumulativeGrossPaise:o.cumulative_gross_paise,cumulativeChargesPaise:o.cumulative_charges_paise,
        status:o.status,expiresAt:o.expires_at,createdAt:o.created_at
      })),
      fills:fills.map(f=>({
        orderId:f.order_id,executionId:f.execution_id,fillSequence:f.fill_sequence,
        quantity:f.fill_quantity,executionPricePaise:f.execution_price_paise,
        grossPaise:f.gross_paise,chargesPaise:f.incremental_charges_paise,
        realizedPnlPaise:f.realized_pnl_paise,quoteTimestampMs:f.quote_timestamp_ms
      })),
      simulationOnly:true,includesCharges:true
    });
  }catch(error){sendError(res,error,"NSE Options LIMIT history could not be loaded.");}
});
app.delete("/paper/derivative/limit-orders/:orderId",async(req,res)=>{
  try{
    const {user}=await auth(req),orderId=String(req.params.orderId||"");
    if(!/^[a-f0-9]{64}$/.test(orderId))return res.status(400).json({error:"A valid Options LIMIT order ID is required."});
    const result=await runtime.callUserRpc(user,"cancel_paper_option_limit_order",{p_order_id:orderId});
    res.set("Cache-Control","private, no-store").json({
      orderId:result?.order_id||orderId,status:result?.status||"CANCELLED",
      releasedCashPaise:result?.released_cash_paise??0,
      releasedCloseQuantity:result?.released_close_quantity??0,
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"NSE Options LIMIT order could not be cancelled.");}
});

app.post("/paper/derivative/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),instrumentKey=String(req.body?.instrument_key||"");
    const lots=Number(req.body?.lots),side=String(req.body?.side||"").toUpperCase(),idempotencyKey=String(req.body?.idempotency_key||"");
    const orderType=String(req.body?.order_type||"MARKET").toUpperCase();
    if(orderType!=="MARKET")return res.status(400).json({error:"Options LIMIT orders are not supported yet. Only MARKET orders are currently available."});
    if(!isUuid(idempotencyKey))return res.status(400).json({error:"A valid UUID idempotency_key is required."});
    if(!["BUY","SELL"].includes(side))return res.status(400).json({error:"Only BUY and SELL to close existing long CE/PE positions are supported."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&["CE","PE"].includes(x.instrument_type)&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE CE/PE contract from the official instrument master."});
    // Resolve contract identity and idempotency before requiring a live quote.
    const metadata=validateDerivativeContract(instrument,{lots,pricePaise:normalizeTickSizePaise(instrument.tick_size),now:Date.now()});
    const orderId=makeOrderId(user.id,idempotencyKey),fingerprint=makeOrderFingerprint({instrumentKey,side,quantity:metadata.quantity});
    const {data:prior,error:priorError}=await userDb.from("paper_derivative_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(priorError)throw Object.assign(new Error("Derivative order idempotency state could not be checked."),{status:503});
    if(prior){
      if(prior.request_fingerprint!==fingerprint||prior.order_id!==orderId)return res.status(409).json({error:"Derivative idempotency key was reused with different order details."});
      const {data:account}=await userDb.from("paper_accounts").select("cash_paise,realized_pnl_paise").eq("user_id",user.id).maybeSingle();
      return res.set("Cache-Control","private, no-store").json({
        orderId:prior.order_id,tradingSymbol:prior.trading_symbol||instrument.trading_symbol,instrumentKey,
        side:prior.side,quantity:prior.quantity,lots:prior.lots,executionPricePaise:prior.execution_price_paise,
        grossPaise:prior.gross_paise,chargesPaise:prior.charges_paise,totalDebitPaise:prior.total_debit_paise,
        netCreditPaise:prior.net_credit_paise,cashPaise:account?.cash_paise??null,
        realizedPnlPaise:prior.realized_pnl_paise??0,idempotentReplay:true,simulationOnly:true,excludesCharges:false
      });
    }
    const {token}=await getUpstoxAccessToken(user.id),{quote}=await getQuote(token,instrumentKey);
    const normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
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
    if(!upstream.ok)throw upstoxHttpError(upstream);
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
    if(!response.ok)throw upstoxHttpError(response);
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
    if(!["MARKET","LIMIT"].includes(orderType))return res.status(400).json({error:"Choose MARKET or LIMIT for Futures orders."});
    const limitPricePaise=orderType==="LIMIT"?Number(req.body?.limit_price_paise):null;
    if(orderType==="LIMIT"&&(!Number.isSafeInteger(limitPricePaise)||limitPricePaise<=0))return res.status(400).json({error:"LIMIT orders require a positive integer limit_price_paise."});
    if(!["BUY","SELL"].includes(side)||product===null)return res.status(400).json({error:"Choose BUY/SELL and a valid Intraday/Delivery futures product."});
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const instrument=instrumentCache.find(x=>x.instrument_key===instrumentKey&&x.instrument_type==="FUT"&&["NSE_FO","BSE_FO"].includes(x.segment));
    if(!instrument)return res.status(400).json({error:"Select a verified NSE/BSE futures contract from the official instrument master."});
    // Resolve the immutable contract metadata first. A retry of an already-filled
    // order must return its original receipt even if the provider quote/token is
    // temporarily unavailable; never re-execute it at a new market price.
    const metadata=validateDerivativeContract(instrument,{
      lots,pricePaise:orderType==="LIMIT"?limitPricePaise:normalizeTickSizePaise(instrument.tick_size),now:Date.now()
    });
    const orderId=makeOrderId(user.id,idempotencyKey);
    const fingerprint=orderType==="LIMIT"
      ?makeOrderFingerprint({instrumentKey,side,quantity:metadata.quantity,orderType:"LIMIT",product,limitPricePaise})
      :makeOrderFingerprint({instrumentKey,side,quantity:metadata.quantity,orderType:"MARKET",product});
    const {data:prior,error:priorError}=await userDb.from("paper_futures_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey).maybeSingle();
    if(priorError)throw Object.assign(new Error("Futures order idempotency state could not be checked."),{status:503});
    if(prior){
      if(prior.request_fingerprint!==fingerprint||prior.order_id!==orderId)return res.status(409).json({error:"Futures idempotency key was reused with different order details."});
      const {data:account}=await userDb.from("paper_accounts").select("cash_paise,reserved_margin_paise").eq("user_id",user.id).maybeSingle();
      if(orderType==="LIMIT"){
        return res.set("Cache-Control","private, no-store").json({
          orderId:prior.order_id,status:prior.status,side:prior.side,product:prior.product,
          orderType:"LIMIT",quantity:prior.quantity,lots:prior.quantity/prior.lot_size,
          limitPricePaise:prior.limit_price_paise,filledQuantity:prior.filled_quantity,
          remainingQuantity:prior.remaining_quantity,averageFillPricePaise:prior.average_fill_price_paise,
          reservedOpenMarginPaise:prior.reserved_open_margin_paise,
          reservedCloseQuantity:prior.reserved_close_quantity,expiresAt:prior.expires_at,
          cashPaise:account?.cash_paise??null,reservedMarginPaise:account?.reserved_margin_paise??null,
          idempotentReplay:true,simulationOnly:true
        });
      }
      return res.set("Cache-Control","private, no-store").json({orderId:prior.order_id,status:prior.status,side:prior.side,product:prior.product,quantity:prior.quantity,lots:prior.quantity/prior.lot_size,executionPricePaise:prior.execution_price_paise,grossPaise:prior.execution_price_paise*prior.quantity,chargesPaise:prior.charges_paise,cashPaise:account?.cash_paise??null,reservedMarginPaise:account?.reserved_margin_paise??null,realizedPnlPaise:prior.realized_pnl_paise,idempotentReplay:true,simulationOnly:true});
    }
    if(orderType==="LIMIT"){
      if(process.env.PAPER_FUTURES_LIMIT_ENABLED!=="true")
        return res.status(503).json({error:"Futures LIMIT submission is currently disabled."});
      if(instrument.exchange!=="NSE"||instrument.segment!=="NSE_FO")
        return res.status(400).json({error:"Futures LIMIT currently supports NSE contracts only; BSE remains disabled."});
      const submitNowMs=Date.now();
      const session=await loadVerifiedExchangeSession(serviceDb,instrument.exchange,submitNowMs);
      if(!isVerifiedSessionOpen(submitNowMs,session))
        return res.status(409).json({error:"A verified open exchange session is required to submit a Futures LIMIT order."});
      const closeMs=Date.parse(session.sessionDate+"T00:00:00+05:30")+session.closeMinute*60000;
      const expiryCutoffMs=Date.parse(metadata.expiry+"T15:30:00+05:30");
      const requestedExpiryMs=req.body?.expires_at?Date.parse(String(req.body.expires_at)):closeMs;
      if(!Number.isFinite(requestedExpiryMs)||requestedExpiryMs<=submitNowMs
         ||requestedExpiryMs>closeMs||requestedExpiryMs>expiryCutoffMs)
        return res.status(400).json({error:"Futures LIMIT expiry must be after now and no later than the verified session close or contract expiry."});
      const expiresAt=new Date(requestedExpiryMs).toISOString();
      const {data:position,error:positionError}=await userDb.from("paper_futures_positions")
        .select("net_quantity,product,reserved_close_quantity")
        .eq("user_id",user.id).eq("instrument_key",instrumentKey).maybeSingle();
      if(positionError)throw Object.assign(new Error("Current Futures position could not be read."),{status:503});
      if(position&&position.product!==product)
        return res.status(409).json({error:"Close the existing Futures position before switching between Intraday and Delivery."});
      const oldQuantity=position?.net_quantity||0;
      const oppositePosition=oldQuantity!==0&&((oldQuantity>0&&side==="SELL")||(oldQuantity<0&&side==="BUY"));
      const availableCloseQuantity=Math.max(0,Math.abs(oldQuantity)-(position?.reserved_close_quantity||0));
      if(oppositePosition&&availableCloseQuantity<metadata.quantity)
        return res.status(409).json({error:"Futures LIMIT close quantity exceeds the unreserved open position."});
      const closeOnly=oppositePosition;
      let openingMarginPaise=0,marginQuoteTimestampMs=null;
      if(!closeOnly){
        const {token}=await getUpstoxAccessToken(user.id);
        const marginResponse=await fetchProvider("https://api.upstox.com/v2/charges/margin",{
          method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
          body:JSON.stringify({instruments:[{
            instrument_key:instrumentKey,quantity:metadata.quantity,
            product:product==="INTRADAY"?"I":"D",transaction_type:side,
            price:limitPricePaise/100
          }]})
        });
        const marginPayload=await readProviderJson(marginResponse);
        if(!marginResponse.ok)throw upstoxHttpError(marginResponse);
        openingMarginPaise=normalizeUpstoxMarginResponse(marginPayload,instrumentKey).requiredMarginPaise;
        marginQuoteTimestampMs=Date.now();
      }
      const rpcNowMs=Date.now();
      const result=await runtime.callUserRpc(user,"submit_paper_futures_limit_order",{
        p_order_id:orderId,p_idempotency_key:idempotencyKey,p_request_fingerprint:fingerprint,
        p_instrument_key:instrumentKey,p_trading_symbol:instrument.trading_symbol,
        p_exchange:instrument.exchange,p_segment:instrument.segment,p_expiry:metadata.expiry,
        p_lot_size:metadata.lotSize,p_tick_size_paise:metadata.tickSizePaise,
        p_side:side,p_product:product,p_quantity:metadata.quantity,
        p_limit_price_paise:limitPricePaise,p_open_margin_paise:openingMarginPaise,
        p_margin_quote_timestamp_ms:marginQuoteTimestampMs,p_now_ms:rpcNowMs,p_expires_at:expiresAt
      });
      const order=result?.order||{};
      return res.set("Cache-Control","private, no-store")
        .status(result?.idempotent_replay?200:201).json({
          orderId:order.order_id||orderId,status:order.status||"PENDING",
          tradingSymbol:instrument.trading_symbol,instrumentKey,exchange:instrument.exchange,
          expiry:metadata.expiry,side,product,orderType:"LIMIT",lots,lotSize:metadata.lotSize,
          quantity:metadata.quantity,limitPricePaise,filledQuantity:order.filled_quantity||0,
          remainingQuantity:order.remaining_quantity??metadata.quantity,
          averageFillPricePaise:order.average_fill_price_paise??null,
          openingMarginPaise:openingMarginPaise,marginEstimateScope:closeOnly?"close_only_no_open_margin":"provider_margin_at_limit_price",
          reservedOpenMarginPaise:order.reserved_open_margin_paise??openingMarginPaise,
          reservedCloseQuantity:order.reserved_close_quantity??(closeOnly?metadata.quantity:0),
          expiresAt:order.expires_at||expiresAt,cashPaise:result?.cash_paise??null,
          reservedMarginPaise:result?.reserved_margin_paise??null,
          idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
        });
    }
    const {token}=await getUpstoxAccessToken(user.id),{quote}=await getQuote(token,instrumentKey);
    const normalized=normalizeProviderQuote(quote,instrumentKey,{maxAgeMs:15000});
    const contract=validateDerivativeContract(instrument,{lots,pricePaise:normalized.pricePaise,now:Date.now()});
    const {data:position,error:positionError}=await userDb.from("paper_futures_positions").select("net_quantity,product").eq("user_id",user.id).eq("instrument_key",instrumentKey).maybeSingle();
    if(positionError)throw Object.assign(new Error("Current futures position could not be read."),{status:503});
    if(position&&position.product!==product)return res.status(409).json({error:"Close the existing futures position before switching between Intraday and Delivery."});
    const oldQuantity=position?.net_quantity||0;
    const closesEntireOrder=oldQuantity!==0&&((oldQuantity>0&&side==="SELL")||(oldQuantity<0&&side==="BUY"))&&Math.abs(oldQuantity)>=contract.quantity;
    // Never size margin from a pre-transaction position snapshot: another order may
    // change it before the account-first SQL lock. For any order that might open or
    // reverse exposure, obtain a conservative estimate for the full submitted size.
    // A position snapshot that suggests a pure close may skip the provider margin call;
    // if it becomes stale and the SQL transaction would open exposure, the SQL ledger
    // rejects the order because p_open_margin_paise is zero (fail closed).
    let openingMarginPaise=0;
    if(!closesEntireOrder){
      const marginResponse=await fetchProvider("https://api.upstox.com/v2/charges/margin",{
        method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
        body:JSON.stringify({instruments:[{instrument_key:instrumentKey,quantity:contract.quantity,product:product==="INTRADAY"?"I":"D",transaction_type:side,price:normalized.pricePaise/100}]})
      });
      const marginPayload=await readProviderJson(marginResponse);
      if(!marginResponse.ok)throw upstoxHttpError(marginResponse);
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
      openingMarginPaise:openingMarginPaise,marginEstimateScope:"full_submitted_quantity_conservative_on_reversal",cashPaise:result?.cash_paise??null,
      reservedMarginPaise:result?.reserved_margin_paise??null,
      realizedPnlPaise:result?.order_realized_pnl_paise??0,
      quoteAgeMs:normalized.quoteAgeMs,idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Futures paper order could not be completed.");}
});
app.post("/paper/futures/orders/:orderId/cancel",async(req,res)=>{
  try{
    const {user}=await auth(req),orderId=String(req.params?.orderId||"");
    if(!/^[a-f0-9]{64}$/.test(orderId))return res.status(400).json({error:"A valid Futures order ID is required."});
    const result=await runtime.callUserRpc(user,"cancel_paper_futures_limit_order",{p_order_id:orderId});
    res.set("Cache-Control","private, no-store").json({
      orderId,status:result?.status||result?.order?.status||"CANCELLED",
      idempotentReplay:result?.idempotent_replay===true,simulationOnly:true
    });
  }catch(error){sendError(res,error,"Futures LIMIT order could not be cancelled.");}
});

app.get("/paper/futures/orders",async(req,res)=>{
  try{
    const {user,userDb}=await auth(req),raw=String(req.query.limit??"50");
    if(!/^\d+$/.test(raw)||Number(raw)<1)return res.status(400).json({error:"Futures order history limit must be from 1 to 100."});
    const {data,error}=await userDb.from("paper_futures_orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(Math.min(Number(raw),100));
    if(error)throw Object.assign(new Error("Futures order history could not be loaded."),{status:503});
    const orders=(data||[]).map(o=>({id:o.order_id,tradingSymbol:o.trading_symbol,instrumentKey:o.instrument_key,exchange:o.exchange,expiry:o.expiry,side:o.side,product:o.product,quantity:o.quantity,filledQuantity:o.filled_quantity??(o.status==="FILLED"?o.quantity:0),remainingQuantity:o.remaining_quantity??(o.status==="FILLED"?0:o.quantity),lotSize:o.lot_size,orderType:o.order_type,limitPricePaise:o.limit_price_paise??null,executionPricePaise:o.execution_price_paise??null,averageFillPricePaise:o.average_fill_price_paise??null,marginReservedPaise:o.margin_reserved_paise??null,reservedOpenMarginPaise:o.reserved_open_margin_paise??0,reservedCloseQuantity:o.reserved_close_quantity??0,expiresAt:o.expires_at??null,chargesPaise:o.charges_paise??0,realizedPnlPaise:o.realized_pnl_paise??0,status:o.status,simulationOnly:true,createdAt:o.created_at?Date.parse(o.created_at):null}));
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
    if(!quoteResponse.ok)throw upstoxHttpError(quoteResponse);
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
    res.set("Cache-Control","private, no-store").json({positions:valued,cashPaise:account.cash_paise,marketValuePaise:0,unrealizedPnlPaise:stalePositions?null:unrealizedPnlPaise,reservedMarginPaise:account.reserved_margin_paise||0,realizedPnlPaise:account.realized_pnl_paise||0,equityPaise:stalePositions?null:account.cash_paise+unrealizedPnlPaise,valuationStatus:stalePositions?"partial_stale":"fresh",stalePositions,marginStatus:"entry_estimate",simulationOnly:true});
  }catch(error){sendError(res,error,"Futures portfolio could not be loaded.");}
});

// Paper Investing routes were retired under the approved Paper Trading-only product scope.

app.post("/stream",async(req,res)=>{
  let upstream,heartbeat,uid=null,reservation=null,leaseId=null,leaseAcquired=false;
  let reconnectTimer=null,reconnectInFlight=false,reconnectAttempts=0,socketGeneration=0;
  const lifecycle=createStreamLifecycle(()=>{
    if(reconnectTimer)clearTimeout(reconnectTimer);
    reconnectTimer=null;
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
  const finishStream=(message,code)=>{
    writeEvent("error",{message,...(code?{code}:{})});
    if(!res.writableEnded)res.end();
    stop();
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
      onLost:()=>finishStream("Live market stream lease expired. Reconnect to continue.","stream_lease_expired"),
      onError:()=>finishStream("Live market stream lease could not be renewed.","stream_lease_renewal_failed")
    });
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    const keys=validateStreamInstrumentKeys(req.body?.instrumentKeys,instrumentCache.map(item=>item.instrument_key),MAX_KEYS);
    const mode=req.body?.mode||"ltpc";
    if(!["ltpc","full","option_greeks"].includes(mode))return res.status(400).json({error:"Unsupported feed mode."});
    const {token}=await getUpstoxAccessToken(uid);
    const authorizeFeed=async()=>{
      const authResponse=await fetchProvider("https://api.upstox.com/v3/feed/market-data-feed/authorize",{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
      if(!authResponse.ok)throw upstoxHttpError(authResponse);
      const authData=await readProviderJson(authResponse);
      if(!authData?.data?.authorized_redirect_uri)throw Object.assign(new Error("Upstox did not return an authorized feed URL."),{status:502,code:"upstream_provider_error"});
      return validateUpstoxFeedUrl(authData.data.authorized_redirect_uri);
    };
    const acceptOrdered=createMarketFeedEventOrderFilter();
    const connectSocket=feedUrl=>{
      if(lifecycle.closed||res.destroyed||res.writableEnded)return;
      const generation=++socketGeneration;
      const previous=upstream;
      if(previous&&previous.readyState<WebSocket.CLOSING)previous.close();
      const socket=new WebSocket(feedUrl,{followRedirects:false,handshakeTimeout:15000,maxPayload:16*1024*1024,perMessageDeflate:false});
      upstream=socket;
      socket.on("open",()=>{
        if(lifecycle.closed||generation!==socketGeneration||upstream!==socket){socket.close();return;}
        writeEvent("status",{connected:true,mode,keys:keys.length,reconnected:generation>1});
        sendUpstoxSubscription(socket,{mode,instrumentKeys:keys}).catch(()=>scheduleReconnect(generation,null));
      });
      socket.on("message",(bytes,isBinary)=>{
        if(lifecycle.closed||generation!==socketGeneration||upstream!==socket||res.destroyed||res.writableEnded)return;
        if(!isBinary)return;
        try{
          const decoded=decodeFeedResponse(FeedResponse,bytes);
          const fresh=filterFreshMarketFeeds(decoded,keys);
          const ordered=fresh&&acceptOrdered(fresh);
          if(ordered)writeEvent("market",ordered);
        }catch(_){writeEvent("error",{message:"Market feed decode failed"});}
      });
      socket.on("error",()=>scheduleReconnect(generation,null));
      socket.on("close",()=>scheduleReconnect(generation,null));
    };
    const scheduleReconnect=(generation,retryAfterSeconds)=>{
      if(lifecycle.closed||generation!==socketGeneration||reconnectTimer||reconnectInFlight)return;
      if(reconnectAttempts>=MAX_RECONNECT_ATTEMPTS){
        finishStream("Live market feed could not recover. Reconnect to continue.","stream_reconnect_exhausted");
        return;
      }
      reconnectAttempts++;
      const delay=reconnectDelayMs(reconnectAttempts,{retryAfterSeconds});
      writeEvent("status",{connected:false,reconnecting:true,attempt:reconnectAttempts,maxAttempts:MAX_RECONNECT_ATTEMPTS,retryInMs:delay});
      reconnectTimer=setTimeout(async()=>{
        reconnectTimer=null;
        if(lifecycle.closed||generation!==socketGeneration)return;
        reconnectInFlight=true;
        try{
          const nextUrl=await authorizeFeed();
          if(lifecycle.closed||generation!==socketGeneration)return;
          connectSocket(nextUrl);
        }catch(error){
          reconnectInFlight=false;
          if(error?.status===401){
            finishStream("Upstox authorization expired. Reconnect your Upstox account.","upstox_reconnect_required");
            return;
          }
          scheduleReconnect(generation,error?.status===429?error.retryAfterSeconds:null);
          return;
        }finally{
          if(!reconnectTimer)reconnectInFlight=false;
        }
      },delay);
      reconnectTimer.unref?.();
    };
    const firstFeedUrl=await authorizeFeed();
    if(res.destroyed||res.writableEnded||lifecycle.closed)return;
    res.status(200).set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.on("drain",onDrain);res.flushHeaders?.();
    writeEvent("status",{connected:false,connecting:true,mode,keys:keys.length});
    connectSocket(firstFeedUrl);
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
      if(getUpstoxUserCooldown(userId)){summary.failed+=userOrders.length;return;}
      let providerHealthy=false;
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
        if(!response.ok)throw upstoxHttpError(response);
        providerHealthy=true;
        clearUpstoxUserCooldown(userId);
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
        if(!providerHealthy)recordUpstoxUserFailure(userId,error);
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

const runPaperIntradayLimitWorker=createPaperIntradayLimitWorker({
  serviceDb,
  ensureInstrumentCache:async()=>{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    return instrumentCache;
  },
  getUpstoxAccessToken,fetchProvider,readProviderJson,normalizeProviderQuote
});

const runPaperProtectiveWorker=createPaperProtectiveWorker({
  serviceDb,
  ensureInstrumentCache:async()=>{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    return instrumentCache;
  },
  getUpstoxAccessToken,fetchProvider,readProviderJson,normalizeProviderQuote
});

const runPaperFuturesLimitWorker=createPaperFuturesLimitWorker({
  serviceDb,
  ensureInstrumentCache:async()=>{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    return instrumentCache;
  },
  getUpstoxAccessToken,fetchProvider,readProviderJson
});

const runPaperOptionLimitWorker=createPaperOptionLimitWorker({
  serviceDb,
  ensureInstrumentCache:async()=>{
    if(!instrumentCache.length||Date.now()-instrumentCacheUpdatedAt>6*60*60*1000)await refreshInstrumentCache();
    return instrumentCache;
  },
  getUpstoxAccessToken,fetchProvider,readProviderJson
});

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
  if(process.env.PAPER_INTRADAY_LIMIT_WORKER_ENABLED==="true"){
    const intervalMs=Math.max(1000,Math.min(10000,Number(process.env.PAPER_INTRADAY_LIMIT_WORKER_INTERVAL_MS)||2000));
    paperIntradayLimitWorkerStatus.enabled=true;paperIntradayLimitWorkerStatus.intervalMs=intervalMs;
    let workerBusy=false,nextWorkerRunAt=0,backoffMs=intervalMs;
    const runWorker=async()=>{
      if(workerBusy||Date.now()<nextWorkerRunAt)return;
      workerBusy=true;
      try{
        const result=await runPaperIntradayLimitWorker({maxOrders:10});
        paperIntradayLimitWorkerStatus.lastRunAt=Date.now();
        paperIntradayLimitWorkerStatus.lastCycle={scanned:result.scanned,filled:result.filled,
          notEligible:result.notEligible,failed:result.failed,expired:result.expired,
          locked:result.locked,cycleError:false};
        backoffMs=intervalMs;nextWorkerRunAt=Date.now()+intervalMs;
        if(result.filled||result.failed||result.expired)console.log("Paper Intraday LIMIT worker cycle",JSON.stringify(result));
      }catch(error){
        paperIntradayLimitWorkerStatus.lastRunAt=Date.now();
        paperIntradayLimitWorkerStatus.lastCycle={scanned:0,filled:0,notEligible:0,failed:1,expired:0,locked:false,cycleError:true};
        nextWorkerRunAt=Date.now()+backoffMs;backoffMs=Math.min(60000,backoffMs*2);
        console.error("Paper Intraday LIMIT worker cycle failed:",error.message);
      }finally{workerBusy=false;}
    };
    runWorker().catch(()=>{});const timer=setInterval(runWorker,intervalMs);timer.unref?.();
    console.log("Paper Intraday LIMIT worker enabled; interval",intervalMs,"ms");
  }
  if(process.env.PAPER_FUTURES_LIMIT_WORKER_ENABLED==="true"){
    const intervalMs=Math.max(1000,Math.min(10000,Number(process.env.PAPER_FUTURES_LIMIT_WORKER_INTERVAL_MS)||2000));
    paperFuturesLimitWorkerStatus.enabled=true;
    paperFuturesLimitWorkerStatus.intervalMs=intervalMs;
    let workerBusy=false,nextWorkerRunAt=0,workerBackoffMs=intervalMs;
    const runWorker=async()=>{
      if(workerBusy||Date.now()<nextWorkerRunAt)return;
      workerBusy=true;
      try{
        const result=await runPaperFuturesLimitWorker({maxOrders:10});
        paperFuturesLimitWorkerStatus.lastRunAt=Date.now();
        paperFuturesLimitWorkerStatus.lastCycle={scanned:result.scanned,filled:result.filled,
          partial:result.partial,notEligible:result.notEligible,failed:result.failed,
          expired:result.expired,locked:result.locked,cycleError:false};
        workerBackoffMs=intervalMs;nextWorkerRunAt=Date.now()+intervalMs;
        if(result.filled||result.partial||result.failed||result.expired)
          console.log("Paper Futures LIMIT worker cycle",JSON.stringify(result));
      }catch(error){
        paperFuturesLimitWorkerStatus.lastRunAt=Date.now();
        paperFuturesLimitWorkerStatus.lastCycle={scanned:0,filled:0,partial:0,
          notEligible:0,failed:1,expired:0,locked:false,cycleError:true};
        nextWorkerRunAt=Date.now()+workerBackoffMs;
        workerBackoffMs=Math.min(60000,workerBackoffMs*2);
        console.error("Paper Futures LIMIT worker cycle failed:",error.message);
      }finally{workerBusy=false;}
    };
    runWorker().catch(()=>{});
    const workerTimer=setInterval(runWorker,intervalMs);
    workerTimer.unref?.();
    console.log("Paper Futures LIMIT worker enabled; interval",intervalMs,"ms");
  }
  if(process.env.PAPER_OPTIONS_LIMIT_ENABLED==="true"
     &&process.env.PAPER_OPTIONS_LIMIT_WORKER_ENABLED==="true"){
    const intervalMs=Math.max(1000,Math.min(10000,Number(process.env.PAPER_OPTIONS_LIMIT_WORKER_INTERVAL_MS)||2000));
    paperOptionLimitWorkerStatus.enabled=true;
    paperOptionLimitWorkerStatus.intervalMs=intervalMs;
    let workerBusy=false,nextWorkerRunAt=0,backoffMs=intervalMs;
    const runWorker=async()=>{
      if(workerBusy||Date.now()<nextWorkerRunAt)return;
      workerBusy=true;
      try{
        const result=await runPaperOptionLimitWorker({maxOrders:10});
        paperOptionLimitWorkerStatus.lastRunAt=Date.now();
        paperOptionLimitWorkerStatus.lastCycle={scanned:result.scanned,filled:result.filled,
          partial:result.partial,notEligible:result.notEligible,failed:result.failed,
          expired:result.expired,locked:result.locked,cycleError:false};
        backoffMs=intervalMs;nextWorkerRunAt=Date.now()+intervalMs;
        if(result.filled||result.partial||result.failed||result.expired)
          console.log("Paper NSE Options LIMIT worker cycle",JSON.stringify(result));
      }catch(error){
        paperOptionLimitWorkerStatus.lastRunAt=Date.now();
        paperOptionLimitWorkerStatus.lastCycle={scanned:0,filled:0,partial:0,
          notEligible:0,failed:1,expired:0,locked:false,cycleError:true};
        nextWorkerRunAt=Date.now()+backoffMs;
        backoffMs=Math.min(60000,backoffMs*2);
        console.error("Paper NSE Options LIMIT worker cycle failed:",error.message);
      }finally{workerBusy=false;}
    };
    runWorker().catch(()=>{});
    const workerTimer=setInterval(runWorker,intervalMs);
    workerTimer.unref?.();
    console.log("Paper NSE Options LIMIT worker enabled; interval",intervalMs,"ms");
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
module.exports={app,start,runPaperLimitWorker,runPaperIntradayLimitWorker,runPaperProtectiveWorker,runPaperFuturesLimitWorker,runPaperOptionLimitWorker};
