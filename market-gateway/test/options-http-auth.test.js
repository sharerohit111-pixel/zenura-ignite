"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");

process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-role-key";
process.env.ALLOWED_ORIGINS="https://zenuraignite.com";
process.env.UPSTOX_TOKEN_ENCRYPTION_KEY="test-key-not-used-by-decrypt-stub";

const TEST_USER_ID="11111111-2222-4333-8444-555555555555";
let authenticated=false;
const rpcCalls=[],userQueries=[];
const TEST_INSTRUMENT_KEY="NSE_FO|NIFTY26NOV25000CE";
const TEST_INSTRUMENT={instrument_key:TEST_INSTRUMENT_KEY,trading_symbol:"NIFTY26NOV25000CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",expiry:"2026-11-26",strike_price:25000,lot_size:65,tick_size:5};
const instrumentModule=require.resolve("../lib/instrument-master-download");
require.cache[instrumentModule]={id:instrumentModule,filename:instrumentModule,loaded:true,exports:{downloadInstrumentMaster:async()=>[TEST_INSTRUMENT]}};
const tokenModule=require.resolve("../lib/upstox-token-crypto");
require.cache[tokenModule]={id:tokenModule,filename:tokenModule,loaded:true,exports:{decryptUpstoxToken:()=>"test-upstox-access-token",encryptUpstoxToken:()=>({})}};
const supabaseModule=require.resolve("@supabase/supabase-js");
require.cache[supabaseModule]={
  id:supabaseModule,filename:supabaseModule,loaded:true,
  exports:{createClient:(_url,key)=>({
    auth:{getUser:async token=>authenticated&&token==="valid-options-test-token"
      ?{data:{user:{id:TEST_USER_ID,email:"options@example.test"}},error:null}
      :{data:{user:null},error:{message:"invalid token"}}},
    from(table){
      userQueries.push({table,key});
      const query={
        select(){return this;},eq(){return this;},order(){return this;},in(){return this;},
        limit(){return Promise.resolve({data:[],error:null});},
        maybeSingle(){
          if(table==="upstox_connections")return Promise.resolve({data:{
            status:"connected",
            token_expires_at:new Date(Date.now()+60_000).toISOString(),
            token_ciphertext:{iv:"test-iv",ciphertext:"test-ciphertext",tag:"test-tag"}
          },error:null});
          return Promise.resolve({data:null,error:null});
        }
      };
      return query;
    },
    rpc:async(name,args)=>{rpcCalls.push({name,args,key});return {data:{
      order_id:args.p_order_id,status:"CANCELLED",released_cash_paise:0,
      released_close_quantity:0,idempotent_replay:false
    },error:null};}
  })}
};

const {app}=require("../supabase-server");

async function withServer(run){
  const server=http.createServer(app);
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();
  try{return await run("http://127.0.0.1:"+address.port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}

async function request(base,path,{method="GET",headers={},body}={}){
  const response=await fetch(base+path,{
    method,headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined
  });
  return {status:response.status,headers:response.headers,body:await response.json()};
}

test("Options MARKET, LIMIT submit, history and cancel APIs reject missing bearer auth",async()=>{
  await withServer(async base=>{
    const cases=[
      ["POST","/paper/derivative/orders",{instrument_key:"NSE|CE",side:"BUY",lots:1,idempotency_key:"00000000-0000-4000-8000-000000000001"}],
      ["POST","/paper/derivative/limit-orders",{instrument_key:"NSE|CE",side:"BUY",lots:1,limit_price_paise:100,idempotency_key:"00000000-0000-4000-8000-000000000002"}],
      ["GET","/paper/derivative/limit-orders",undefined],
      ["DELETE","/paper/derivative/limit-orders/"+("a".repeat(64)),undefined]
    ];
    for(const [method,path,body] of cases){
      const result=await request(base,path,{method,body});
      assert.equal(result.status,401,method+" "+path);
      assert.equal(result.body.error,"Sign in required");
    }
  });
});

test("Options APIs reject invalid Supabase sessions before touching user data or RPCs",async()=>{
  await withServer(async base=>{
    for(const path of ["/paper/derivative/orders","/paper/derivative/limit-orders"]){
      const result=await request(base,path,{
        method:"POST",
        headers:{Authorization:"Bearer deliberately-invalid-token"},
        body:{instrument_key:"NSE|CE",side:"BUY",lots:1,idempotency_key:"00000000-0000-4000-8000-000000000003"}
      });
      assert.equal(result.status,401);
      assert.equal(result.body.error,"Supabase session is invalid or expired");
    }
  });
});


test("authenticated NSE Options MARKET BUY submits with fresh ask and verified user RPC",async()=>{
  authenticated=true;
  rpcCalls.length=0;userQueries.length=0;
  const originalFetch=global.fetch;
  global.fetch=async(url,options={})=>{
    if(String(url).startsWith("http://127.0.0.1:"))return originalFetch(url,options);
    if(String(url).includes("assets.upstox.com/market-quote/instruments"))
      return new Response("instrument-master-test",{status:200});
    if(String(url).includes("api.upstox.com/v3/market-quote/quotes")){
      const now=Date.now();
      return new Response(JSON.stringify({status:"success",data:{[TEST_INSTRUMENT_KEY]:{
        instrument_token:TEST_INSTRUMENT_KEY,timestamp:new Date(now-500).toISOString(),
        depth:{buy:[{price:12.35,quantity:130}],sell:[{price:12.4,quantity:130}]},last_price:99.99
      }}}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    throw new Error("Unexpected test fetch URL: "+url);
  };
  try{
    await withServer(async base=>{
      const result=await request(base,"/paper/derivative/orders",{
        method:"POST",headers:{Authorization:"Bearer valid-options-test-token"},
        body:{instrument_key:TEST_INSTRUMENT_KEY,side:"BUY",lots:1,
          idempotency_key:"00000000-0000-4000-8000-000000000010"}
      });
      assert.equal(result.status,201,JSON.stringify(result.body));
      assert.equal(result.body.executionPricePaise,1240);
      assert.equal(result.body.quantity,65);
      assert.equal(result.body.simulationOnly,true);
      assert.equal(rpcCalls.length,1);
      assert.equal(rpcCalls[0].name,"execute_paper_long_option_order");
      assert.equal(rpcCalls[0].args.p_user_id,TEST_USER_ID);
      assert.equal(rpcCalls[0].args.p_exchange,"NSE");
      assert.equal(rpcCalls[0].args.p_segment,"NSE_FO");
      assert.equal(rpcCalls[0].args.p_side,"BUY");
      assert.equal(rpcCalls[0].args.p_execution_price_paise,1240);
      assert.equal(rpcCalls[0].key,"test-service-role-key");
      assert.ok(userQueries.some(q=>q.table==="upstox_connections"&&q.key==="test-service-role-key"));
      assert.ok(userQueries.some(q=>q.table==="paper_derivative_orders"&&q.key==="test-publishable-key"));
    });
  }finally{
    global.fetch=originalFetch;
    authenticated=false;
  }
});

test("authenticated Options history and cancellation APIs use verified user scope",async()=>{
  authenticated=true;
  rpcCalls.length=0;userQueries.length=0;
  try{
    await withServer(async base=>{
      const headers={Authorization:"Bearer valid-options-test-token"};
      const marketHistory=await request(base,"/paper/derivative/orders",{headers});
      assert.equal(marketHistory.status,200);
      assert.deepEqual(marketHistory.body.orders,[]);
      const limitHistory=await request(base,"/paper/derivative/limit-orders",{headers});
      assert.equal(limitHistory.status,200);
      assert.deepEqual(limitHistory.body.orders,[]);
      assert.deepEqual(limitHistory.body.fills,[]);
      const orderId="a".repeat(64);
      const cancelled=await request(base,"/paper/derivative/limit-orders/"+orderId,{method:"DELETE",headers});
      assert.equal(cancelled.status,200);
      assert.equal(cancelled.body.orderId,orderId);
      assert.equal(cancelled.body.status,"CANCELLED");
      assert.equal(rpcCalls.length,1);
      assert.equal(rpcCalls[0].name,"cancel_paper_option_limit_order");
      assert.equal(rpcCalls[0].args.p_user_id,TEST_USER_ID);
      assert.equal(rpcCalls[0].args.p_order_id,orderId);
      assert.equal(rpcCalls[0].key,"test-service-role-key");
      assert.deepEqual(userQueries.map(q=>q.table),[
        "paper_derivative_orders","paper_option_limit_orders"
      ]);
      assert.ok(userQueries.every(q=>q.key==="test-publishable-key"));
    });
  }finally{authenticated=false;}
});
