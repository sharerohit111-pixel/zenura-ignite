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
const {isUuid}=require("./lib/order-idempotency");
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
const MAX_KEYS=Math.min(Math.max(Number(process.env.MAX_INSTRUMENT_KEYS||100),1),500);
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
  instrumentMasterUpdatedAt:instrumentCacheUpdatedAt||null
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

async function start(){
  if(!ENC_KEY||!UPSTOX_CLIENT_ID||!UPSTOX_CLIENT_SECRET||!UPSTOX_REDIRECT_URI){
    throw new Error("Supabase gateway secrets and Upstox OAuth configuration are required.");
  }
  await loadProto();
  app.listen(PORT,"0.0.0.0",()=>console.log("Supabase-native ZENURA market gateway listening on",PORT));
  refreshInstrumentCache().catch(error=>console.error("Initial instrument refresh failed:",error.message));
}
if(require.main===module)start().catch(error=>{console.error("Supabase gateway startup failed:",error.message);process.exit(1);});
module.exports={app,start};
