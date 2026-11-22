"use strict";

const TABLES=Object.freeze({
  account:"paper_accounts",
  equityPositions:"paper_equity_positions",
  derivativePositions:"paper_derivative_positions",
  orders:"paper_orders",
  derivativeOrders:"paper_derivative_orders",
  watchlists:"paper_watchlists"
});
function httpError(message,status){return Object.assign(new Error(message),{status});}
function bearerToken(request){
  const value=request?.get?.("authorization")||"";
  const match=/^Bearer ([^\\s,]+)$/i.exec(value);
  if(!match)throw httpError("Sign in required",401);
  return match[1];
}
function createSupabasePaperReadTransport(options={}){
  const base=String(options.supabaseUrl||"").replace(/\\/+$/,"");
  const publishableKey=options.publishableKey;
  const identityAdapter=options.identityAdapter;
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  let parsed;
  try{parsed=new URL(base);}catch{throw new TypeError("A valid Supabase URL is required");}
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/")throw new TypeError("Supabase URL must be an HTTPS project origin");
  if(typeof publishableKey!=="string"||!publishableKey.trim())throw new TypeError("Supabase publishable key is required");
  if(!identityAdapter||typeof identityAdapter.resolveIdentity!=="function")throw new TypeError("A Firebase-verified identity adapter is required");
  if(typeof fetchImpl!=="function")throw new TypeError("A fetch implementation is required");

  async function read(tableKey,{request,auth,limit=100,offset=0}={}){
    const table=TABLES[tableKey];
    if(!table)throw httpError("Paper trading read is not allowlisted",400);
    if(!Number.isInteger(limit)||limit<1||limit>100)throw httpError("Read limit must be between 1 and 100",400);
    if(!Number.isInteger(offset)||offset<0||offset>1000000)throw httpError("Read offset is invalid",400);
    const token=bearerToken(request);
    const identity=await identityAdapter.resolveIdentity({request,auth});
    const url=new URL(base+"/rest/v1/"+table);
    url.searchParams.set("select","*");
    url.searchParams.set("user_id","eq."+identity.supabaseUserId);
    url.searchParams.set("limit",String(limit));
    url.searchParams.set("offset",String(offset));
    if(tableKey==="orders"||tableKey==="derivativeOrders")url.searchParams.set("order","created_at.desc,order_id.desc");
    let response;
    try{
      response=await fetchImpl(url.toString(),{method:"GET",headers:{
        apikey:publishableKey,
        Authorization:"Bearer "+token,
        Accept:"application/json"
      }});
    }catch{throw httpError("Supabase Paper Trading read service is unavailable",503);}
    if(!response?.ok)throw httpError("Supabase Paper Trading read was rejected",503);
    let rows;
    try{rows=await response.json();}catch{throw httpError("Supabase Paper Trading response is invalid",503);}
    if(!Array.isArray(rows))throw httpError("Supabase Paper Trading response is invalid",503);
    return rows;
  }
  return Object.freeze({
    getAccount:async context=>(await read("account",{...context,limit:1}))[0]||null,
    listEquityPositions:context=>read("equityPositions",context),
    listDerivativePositions:context=>read("derivativePositions",context),
    listOrders:context=>read("orders",context),
    listDerivativeOrders:context=>read("derivativeOrders",context),
    listWatchlists:context=>read("watchlists",context)
  });
}
module.exports={TABLES,createSupabasePaperReadTransport};
