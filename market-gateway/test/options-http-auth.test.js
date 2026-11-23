"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");

process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-role-key";
process.env.ALLOWED_ORIGINS="https://zenuraignite.com";

const supabaseModule=require.resolve("@supabase/supabase-js");
require.cache[supabaseModule]={
  id:supabaseModule,filename:supabaseModule,loaded:true,
  exports:{createClient:()=>({
    auth:{getUser:async()=>({data:{user:null},error:{message:"invalid token"}})},
    from(){throw new Error("Unauthenticated request reached user database");},
    rpc(){throw new Error("Unauthenticated request reached privileged RPC");}
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

test("Options order APIs do not leak authenticated responses to shared caches",async()=>{
  await withServer(async base=>{
    const result=await request(base,"/paper/derivative/orders");
    assert.equal(result.status,401);
    assert.equal(result.headers.get("cache-control"),null);
  });
});
