"use strict";

const {upstoxHttpError}=require("./upstox-http-policy");
const {getUpstoxUserCooldown,recordUpstoxUserFailure,clearUpstoxUserCooldown}=require("./upstox-user-cooldown");

const crypto=require("node:crypto");
const {normalizeWorkerCursor,groupOrdersByUser}=require("./paper-limit-worker");
const {isEligibleIntradayLimitOrder}=require("./intraday-limit-policy");
const {loadVerifiedExchangeSession}=require("./exchange-session-calendar");

function createPaperIntradayLimitWorker({
  serviceDb,ensureInstrumentCache,getUpstoxAccessToken,fetchProvider,
  readProviderJson,normalizeProviderQuote,loadSession=loadVerifiedExchangeSession
}){
  if(!serviceDb||typeof serviceDb.rpc!=="function"||typeof serviceDb.from!=="function"
     ||typeof ensureInstrumentCache!=="function"||typeof getUpstoxAccessToken!=="function"
     ||typeof fetchProvider!=="function"||typeof readProviderJson!=="function"
     ||typeof normalizeProviderQuote!=="function"||typeof loadSession!=="function"){
    throw new TypeError("Intraday LIMIT worker dependencies are incomplete.");
  }

  return async function runPaperIntradayLimitWorker({maxOrders=50}={}){
    if(!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>100)
      throw new TypeError("Intraday LIMIT worker batch size is invalid.");
    const leaseToken=crypto.randomUUID(),leaseNow=Date.now();
    const lease=await serviceDb.rpc("acquire_paper_market_worker_lease",{
      p_state_key:"paper_intraday_limit_orders",p_lease_token:leaseToken,
      p_now_ms:leaseNow,p_ttl_ms:240000
    });
    if(lease?.error)throw new Error("Intraday LIMIT worker lease could not be acquired.");
    if(lease?.data!==true)return {locked:true,scanned:0,filled:0,notEligible:0,failed:0,expired:0};

    const summary={locked:false,scanned:0,filled:0,notEligible:0,failed:0,expired:0};
    try{
      const expiry=await serviceDb.rpc("expire_paper_intraday_limit_orders",{p_batch_size:Math.min(500,maxOrders*5)});
      if(expiry?.error)throw new Error("Intraday LIMIT session expiry could not be completed.");
      summary.expired=Number.isInteger(expiry.data)?expiry.data:0;

      const instruments=await ensureInstrumentCache();
      if(!Array.isArray(instruments)||!instruments.length)
        throw new Error("Official instrument master is unavailable for Intraday LIMIT worker.");
      const stateResult=await serviceDb.from("paper_market_worker_state")
        .select("cursor_created_at,cursor_order_id")
        .eq("state_key","paper_intraday_limit_orders").maybeSingle();
      if(stateResult.error)throw new Error("Intraday LIMIT worker cursor could not be read.");
      let cursor=normalizeWorkerCursor(stateResult.data);
      const loadBatch=position=>{
        let query=serviceDb.from("paper_orders")
          .select("order_id,user_id,instrument_key,trading_symbol,exchange,side,product,order_type,status,quantity,limit_price_paise,simulation_only,created_at")
          .eq("order_type","LIMIT").eq("status","PENDING").eq("product","INTRADAY")
          .eq("simulation_only",true).order("created_at",{ascending:true})
          .order("order_id",{ascending:true}).limit(maxOrders);
        if(position.createdAt&&position.orderId)
          query=query.or("created_at.gt."+position.createdAt+",and(created_at.eq."+position.createdAt+",order_id.gt."+position.orderId+")");
        return query;
      };
      let batch=await loadBatch(cursor);
      if(batch.error)throw new Error("Pending Intraday LIMIT orders could not be scanned.");
      if(!(batch.data||[]).length&&(cursor.createdAt||cursor.orderId)){
        cursor={createdAt:null,orderId:null};
        const reset=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()})
          .eq("state_key","paper_intraday_limit_orders").eq("lease_token",leaseToken);
        if(reset.error)throw new Error("Intraday LIMIT worker cursor could not be reset.");
        batch=await loadBatch(cursor);
        if(batch.error)throw new Error("Pending Intraday LIMIT orders could not be rescanned.");
      }
      const orders=batch.data||[];
      summary.scanned=orders.length;
      const groups=[...groupOrdersByUser(orders).entries()];
      const processUserOrders=async([userId,userOrders])=>{
        if(getUpstoxUserCooldown(userId)){summary.failed+=userOrders.length;return;}
        let providerHealthy=false;
        try{
          const validOrders=userOrders.filter(order=>{
            const instrument=instruments.find(item=>item.instrument_key===order.instrument_key);
            return instrument&&instrument.instrument_type==="EQ"
              &&["NSE_EQ","BSE_EQ"].includes(instrument.segment)
              &&instrument.exchange===order.exchange&&["NSE","BSE"].includes(order.exchange);
          });
          summary.notEligible+=userOrders.length-validOrders.length;
          if(!validOrders.length)return;
          const {token}=await getUpstoxAccessToken(userId);
          const keys=[...new Set(validOrders.map(order=>order.instrument_key))];
          const response=await fetchProvider(
            "https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),
            {headers:{Authorization:"Bearer "+token,Accept:"application/json"}}
          );
          const payload=await readProviderJson(response);
          if(!response.ok)throw upstoxHttpError(response);
          providerHealthy=true;
          clearUpstoxUserCooldown(userId);
          const entries=Object.values(payload?.data||{});
          const sessionCache=new Map();
          for(const order of validOrders){
            if(!sessionCache.has(order.exchange))
              sessionCache.set(order.exchange,await loadSession(serviceDb,order.exchange,Date.now()));
            const session=sessionCache.get(order.exchange);
            if(!session){summary.notEligible++;continue;}
            const entry=entries.find(item=>item?.instrument_token===order.instrument_key);
            let quote=null;
            try{quote=normalizeProviderQuote(entry,order.instrument_key,{maxAgeMs:15000});}catch(_){}
            const nowMs=Date.now();
            if(!isEligibleIntradayLimitOrder(order,quote,nowMs,session)){
              summary.notEligible++;continue;
            }
            const result=await serviceDb.rpc("execute_paper_intraday_limit_fill",{
              p_order_id:order.order_id,p_execution_price_paise:quote.pricePaise,
              p_quote_timestamp_ms:quote.tradeTimeMs,
              p_quote_age_ms:Math.max(0,nowMs-quote.tradeTimeMs),p_now_ms:nowMs
            });
            if(result?.error){
              if(["23514","22023","P0002"].includes(result.error.code))summary.notEligible++;
              else{summary.failed++;console.warn("Intraday LIMIT fill RPC failed",{orderId:order.order_id,code:result.error.code||"unknown"});}
            }else if(result?.data?.status==="FILLED"){
              if(!result.data.already_filled)summary.filled++;
            }else summary.notEligible++;
          }
        }catch(error){
          if(!providerHealthy)recordUpstoxUserFailure(userId,error);
          summary.failed+=userOrders.length;
          console.warn("Intraday LIMIT user batch skipped",{userId,errorName:error?.name||"Error",status:error?.status||500,code:error?.code||"unknown"});
        }
      };
      for(let offset=0;offset<groups.length;offset+=5)
        await Promise.all(groups.slice(offset,offset+5).map(processUserOrders));

      if(orders.length){
        const last=orders[orders.length-1];
        const saved=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:last.created_at,cursor_order_id:last.order_id,updated_at:new Date().toISOString()})
          .eq("state_key","paper_intraday_limit_orders").eq("lease_token",leaseToken);
        if(saved.error)throw new Error("Intraday LIMIT worker cursor could not be saved.");
      }else{
        const saved=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date().toISOString()})
          .eq("state_key","paper_intraday_limit_orders").eq("lease_token",leaseToken);
        if(saved.error)throw new Error("Intraday LIMIT worker cursor could not be reset.");
      }
      return summary;
    }finally{
      const released=await serviceDb.rpc("release_paper_market_worker_lease",{
        p_state_key:"paper_intraday_limit_orders",p_lease_token:leaseToken,p_now_ms:Date.now()
      });
      if(released?.error)console.warn("Intraday LIMIT worker lease release failed",{code:released.error.code||"unknown"});
    }
  };
}

module.exports={createPaperIntradayLimitWorker};
