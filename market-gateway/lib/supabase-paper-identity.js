"use strict";

const {isUuid}=require("./order-idempotency");
const {authenticateFirebaseRequest}=require("./firebase-auth");
const RESOLVED_IDENTITY=Symbol("resolved-paper-trading-identity");
const USER_SCOPED_RPCS=new Set([
  "execute_paper_market_order",
  "submit_paper_limit_order",
  "cancel_paper_limit_order",
  "initialize_paper_trading_account",
  "execute_paper_long_option_order"
]);

function safeError(message,status){
  return Object.assign(new Error(message),{status});
}
function bearerToken(request){
  const header=request?.get?.("authorization")||"";
  const match=/^Bearer ([^\s,]+)$/i.exec(header);
  if(!match)throw safeError("Sign in required",401);
  return match[1];
}
function validateFirebaseClaims(decoded,projectId){
  if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))throw safeError("Verified Firebase identity is required",401);
  const uid=decoded.uid,sub=decoded.sub;
  if(typeof uid!=="string"||!uid||uid.length>128||sub!==uid)throw safeError("Firebase identity subject is invalid",401);
  if(decoded.aud!==projectId||decoded.iss!=="https://securetoken.google.com/"+projectId)throw safeError("Firebase identity belongs to an unexpected project",401);
  if(decoded.role!=="authenticated")throw safeError("Firebase account is not enabled for Supabase access",403);
  return uid;
}
function createSupabasePaperTradingIdentityAdapter(options={}){
  const base=String(options.supabaseUrl||"").replace(/\/+$/,"");
  const publishableKey=options.publishableKey;
  const firebaseProjectId=options.firebaseProjectId;
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  let parsed;
  try{parsed=new URL(base);}catch{throw new TypeError("A valid Supabase URL is required");}
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/")throw new TypeError("Supabase URL must be an HTTPS project origin");
  if(typeof publishableKey!=="string"||!publishableKey.trim())throw new TypeError("Supabase publishable key is required");
  if(typeof firebaseProjectId!=="string"||!/^[a-z][a-z0-9-]{4,62}$/.test(firebaseProjectId))throw new TypeError("A valid Firebase project ID is required");
  if(typeof fetchImpl!=="function")throw new TypeError("A fetch implementation is required");

  async function resolveIdentity({request,auth}={}){
    // Verify and forward the token from the same request object; callers cannot pair
    // a verified decoded token with a different raw Bearer token.
    const idToken=bearerToken(request);
    const decodedToken=await authenticateFirebaseRequest(request,auth);
    const firebaseUid=validateFirebaseClaims(decodedToken,firebaseProjectId);
    let response;
    try{
      response=await fetchImpl(base+"/rest/v1/rpc/current_paper_user_id",{
        method:"POST",
        headers:{
          apikey:publishableKey,
          Authorization:"Bearer "+idToken,
          Accept:"application/json",
          "Content-Type":"application/json"
        },
        body:"{}"
      });
    }catch{
      throw safeError("Supabase identity service is unavailable",503);
    }
    if(!response||!response.ok){
      // A verified Firebase token rejected here indicates missing third-party-auth
      // configuration, a stale token, or an unavailable schema. Do not leak details.
      throw safeError("Supabase identity service rejected the verified Firebase token",503);
    }
    let userId;
    try{userId=await response.json();}catch{throw safeError("Supabase identity response is invalid",503);}
    if(userId===null)throw safeError("Paper trading identity is not provisioned",403);
    if(typeof userId!=="string"||!isUuid(userId))throw safeError("Supabase identity response is invalid",503);
    const identity={firebaseUid,supabaseUserId:userId};
    Object.defineProperty(identity,RESOLVED_IDENTITY,{value:true});
    return Object.freeze(identity);
  }
  return Object.freeze({resolveIdentity});
}

function buildPaperTradingRpcArgs(identity,rpcName,args={}){
  if(!identity||identity[RESOLVED_IDENTITY]!==true||!isUuid(identity.supabaseUserId))throw safeError("A resolved Firebase-to-Supabase identity is required",401);
  if(!USER_SCOPED_RPCS.has(rpcName))throw safeError("Paper trading RPC is not allowlisted",400);
  if(!args||typeof args!=="object"||Array.isArray(args))throw safeError("Paper trading RPC arguments must be an object",400);
  if(Object.prototype.hasOwnProperty.call(args,"p_user_id"))throw safeError("User ID is assigned by the trusted identity adapter",400);
  return Object.freeze({...args,p_user_id:identity.supabaseUserId});
}

module.exports={
  USER_SCOPED_RPCS,
  buildPaperTradingRpcArgs,
  createSupabasePaperTradingIdentityAdapter
};
