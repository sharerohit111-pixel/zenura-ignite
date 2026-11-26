"use strict";

const {upstoxHttpError}=require("./upstox-http-policy");
const {getUpstoxUserCooldown,recordUpstoxUserFailure,clearUpstoxUserCooldown}=require("./upstox-user-cooldown");

const crypto=require("node:crypto");
const {groupOrdersByUser}=require("./paper-limit-worker");
const {evaluateProtectiveOrder,isSupportedProtectiveOrder,isPositionCloseable}=require("./protective-order-worker");

function createPaperProtectiveWorker({
  serviceDb,ensureInstrumentCache,getUpstoxAccessToken,
  fetchProvider,readProviderJson,normalizeProviderQuote
}){
  for(const [name,fn] of Object.entries({ensureInstrumentCache,getUpstoxAccessToken,fetchProvider,readProviderJson,normalizeProviderQuote})){
    if(typeof fn!=="function")throw new TypeError(name+" dependency is required.");
  }
  if(!serviceDb||typeof serviceDb.rpc!=="function"||typeof serviceDb.from!=="function")
    throw new TypeError("serviceDb dependency is required.");

  return async function runPaperProtectiveWorker({maxOrders=20}={}){
    if(!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>50)
      throw new TypeError("Protective worker batch size is invalid.");
    const leaseToken=crypto.randomUUID();
    const lease=await serviceDb.rpc("acquire_paper_market_worker_lease",{
      p_state_key:"paper_protective_orders",p_lease_token:leaseToken,p_now_ms:Date.now(),p_ttl_ms:240000
    });
    if(lease?.error)throw new Error("Protective worker lease could not be acquired.");
    if(lease?.data!==true)return {locked:true,scanned:0,filled:0,notEligible:0,failed:0};
    const summary={locked:false,scanned:0,filled:0,notEligible:0,failed:0};
    try{
      const instrumentCache=await ensureInstrumentCache();
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
        if(getUpstoxUserCooldown(userId)){
          summary.failed+=userOrders.length;
          const checkedAt=new Date().toISOString();
          for(const order of userOrders){
            const marked=await serviceDb.from("paper_protective_orders")
              .update({worker_checked_at:checkedAt})
              .eq("order_id",order.order_id).eq("status","ACTIVE");
            if(marked.error)summary.failed++;
          }
          return;
        }
        let providerHealthy=false;
        try{
          const validOrders=userOrders.filter(order=>{
            const instrument=instrumentCache.find(x=>x.instrument_key===order.instrument_key);
            return isSupportedProtectiveOrder(order)&&instrument&&instrument.instrument_type==="EQ"
              &&["NSE_EQ","BSE_EQ"].includes(instrument.segment)
              &&(order.product==="DELIVERY"||order.product==="INTRADAY");
          });
          const validIds=new Set(validOrders.map(order=>order.order_id));
          const invalidOrders=userOrders.filter(order=>!validIds.has(order.order_id));
          summary.notEligible+=invalidOrders.length;
          for(const order of invalidOrders){
            const marked=await serviceDb.from("paper_protective_orders")
              .update({worker_checked_at:new Date().toISOString()})
              .eq("order_id",order.order_id).eq("status","ACTIVE");
            if(marked.error)summary.failed++;
          }
          if(!validOrders.length)return;
          const {token}=await getUpstoxAccessToken(userId);
          const keys=[...new Set(validOrders.map(order=>order.instrument_key))];
          const response=await fetchProvider("https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),
            {headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
          const payload=await readProviderJson(response);
          if(!response.ok)throw upstoxHttpError(response);
          providerHealthy=true;
          clearUpstoxUserCooldown(userId);
          const entries=Object.values(payload?.data||{}),now=Date.now();
          const positionsResult=await serviceDb.from("paper_equity_positions")
            .select("instrument_key,product,quantity,reserved_quantity")
            .eq("user_id",userId);
          if(positionsResult.error)throw new Error("Equity positions for protective orders could not be read.");
          const positions=positionsResult.data||[];
          for(const order of validOrders){
            const entry=entries.find(item=>item?.instrument_token===order.instrument_key);
            let quote=null;
            try{
              const normalized=normalizeProviderQuote(entry,order.instrument_key,{now,maxAgeMs:15000});
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
          if(!providerHealthy)recordUpstoxUserFailure(userId,error);
          summary.failed+=userOrders.length;
          const checkedAt=new Date().toISOString();
          for(const order of userOrders){
            const marked=await serviceDb.from("paper_protective_orders")
              .update({worker_checked_at:checkedAt})
              .eq("order_id",order.order_id).eq("status","ACTIVE");
            if(marked.error)summary.failed++;
          }
          console.warn("Protective user batch skipped",{userId,errorName:error?.name||"Error",status:error?.status||500,code:error?.code||"unknown"});
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
  };
}

module.exports={createPaperProtectiveWorker};
