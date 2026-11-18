"use strict";
const express=require("express");
const WebSocket=require("ws");
const protobuf=require("protobufjs");
const admin=require("firebase-admin");
const crypto=require("node:crypto");
const path=require("node:path");
const {gunzipSync}=require("node:zlib");
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
    res.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");
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
app.post("/stream",async(req,res)=>{
  let upstream;
  let heartbeat;
  try{
    const decoded=await authenticate(req);
    const keys=[...new Set(Array.isArray(req.body?.instrumentKeys)?req.body.instrumentKeys:[])];
    const mode=req.body?.mode||"ltpc";
    if(!keys.length||keys.length>MAX_KEYS||keys.some(k=>typeof k!=="string"||k.length>100))
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
