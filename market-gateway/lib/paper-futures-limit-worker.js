"use strict";

const {upstoxHttpError}=require("./upstox-http-policy");
const {getUpstoxUserCooldown,recordUpstoxUserFailure,clearUpstoxUserCooldown}=require("./upstox-user-cooldown");

const crypto=require("node:crypto");
const {normalizeWorkerCursor,groupOrdersByUser}=require("./paper-limit-worker");
const {loadVerifiedExchangeSession,marketDateString}=require("./exchange-session-calendar");
const {marketClockParts}=require("./intraday-limit-policy");
const {normalizeTickSizePaise,normalizeExpiryDate}=require("./derivative-contract");
const {calculateFuturesTradeCharges}=require("./trading-charges");
const {evaluateUpstoxRestDerivativeLimit}=require("./upstox-rest-executable-quote");

function isVerifiedSessionOpen(nowMs,session){
  if(!Number.isSafeInteger(nowMs)||nowMs<1||!session||session.isTradingDay!==true
     ||!["NSE","BSE"].includes(session.exchange)
     ||!Number.isInteger(session.openMinute)||!Number.isInteger(session.closeMinute)
     ||session.openMinute<0||session.closeMinute>1440
     ||session.openMinute>=session.closeMinute)return false;
  const clock=marketClockParts(nowMs);
  const date=clock.year+"-"+String(clock.month).padStart(2,"0")+"-"+String(clock.day).padStart(2,"0");
  const minute=clock.hour*60+clock.minute;
  return session.sessionDate===date&&minute>=session.openMinute&&minute<session.closeMinute;
}
function isContractExpired(order,nowMs){
  const expiry=normalizeExpiryDate(order?.expiry);
  if(!expiry||!Number.isSafeInteger(nowMs)||nowMs<1)return true;
  const cutoff=Date.parse(expiry+"T15:30:00+05:30");
  return !Number.isFinite(cutoff)||nowMs>=cutoff;
}
function isValidNseFuture(order,instrument){
  return !!order&&!!instrument&&order.order_type==="LIMIT"
    &&["PENDING","PARTIALLY_FILLED"].includes(order.status)
    &&order.simulation_only===true
    &&["INTRADAY","DELIVERY"].includes(order.product)
    &&order.exchange==="NSE"&&order.segment==="NSE_FO"
    &&instrument.exchange==="NSE"&&instrument.segment==="NSE_FO"
    &&instrument.instrument_type==="FUT"
    &&instrument.instrument_key===order.instrument_key
    &&instrument.trading_symbol===order.trading_symbol
    &&normalizeExpiryDate(instrument.expiry)===normalizeExpiryDate(order.expiry)
    &&Number.isSafeInteger(instrument.lot_size)&&instrument.lot_size===order.lot_size
    &&normalizeTickSizePaise(instrument.tick_size)===order.tick_size_paise
    &&Number.isSafeInteger(order.remaining_quantity)&&order.remaining_quantity>0
    &&Number.isSafeInteger(order.limit_price_paise)&&order.limit_price_paise>0
    &&Number.isSafeInteger(order.tick_size_paise)&&order.tick_size_paise>0
    &&order.limit_price_paise%order.tick_size_paise===0
    &&Number.isSafeInteger(order.lot_size)&&order.lot_size>0
    &&["BUY","SELL"].includes(order.side)
    &&typeof order.expires_at==="string"&&Number.isFinite(Date.parse(order.expires_at));
}
function cumulativeFillCharges({fills,grossPaise,exchange,side}){
  let priorGross=0;
  for(const fill of Array.isArray(fills)?fills:[]){
    if(!Number.isSafeInteger(fill?.gross_paise)||fill.gross_paise<0)
      throw new Error("Stored Futures fill turnover is invalid.");
    priorGross+=fill.gross_paise;
    if(!Number.isSafeInteger(priorGross))throw new Error("Cumulative Futures turnover exceeds safe limits.");
  }
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1
     ||!Number.isSafeInteger(priorGross+grossPaise))
    throw new Error("Futures fill turnover exceeds safe limits.");
  const before=priorGross===0?0:calculateFuturesTradeCharges({
    grossPaise:priorGross,exchange,side
  }).totalChargesPaise;
  const after=calculateFuturesTradeCharges({
    grossPaise:priorGross+grossPaise,exchange,side
  }).totalChargesPaise;
  const incremental=after-before;
  if(!Number.isSafeInteger(incremental)||incremental<0)
    throw new Error("Incremental Futures charges are invalid.");
  return incremental;
}

function createPaperFuturesLimitWorker({
  serviceDb,ensureInstrumentCache,getUpstoxAccessToken,fetchProvider,
  readProviderJson,loadSession=loadVerifiedExchangeSession,now=Date.now
}){
  if(!serviceDb||typeof serviceDb.rpc!=="function"||typeof serviceDb.from!=="function"
     ||typeof ensureInstrumentCache!=="function"||typeof getUpstoxAccessToken!=="function"
     ||typeof fetchProvider!=="function"||typeof readProviderJson!=="function"
     ||typeof loadSession!=="function"||typeof now!=="function"){
    throw new TypeError("Futures LIMIT worker dependencies are incomplete.");
  }

  return async function runPaperFuturesLimitWorker({maxOrders=50}={}){
    if(!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>100)
      throw new TypeError("Futures LIMIT worker batch size is invalid.");
    const leaseToken=crypto.randomUUID(),leaseNow=now();
    const lease=await serviceDb.rpc("acquire_paper_market_worker_lease",{
      p_state_key:"paper_futures_limit_orders",p_lease_token:leaseToken,
      p_now_ms:leaseNow,p_ttl_ms:240000
    });
    if(lease?.error)throw new Error("Futures LIMIT worker lease could not be acquired.");
    if(lease?.data!==true)
      return {locked:true,scanned:0,filled:0,partial:0,notEligible:0,failed:0,expired:0};

    const summary={locked:false,scanned:0,filled:0,partial:0,notEligible:0,failed:0,expired:0};
    try{
      const instruments=await ensureInstrumentCache();
      if(!Array.isArray(instruments)||!instruments.length)
        throw new Error("Official Upstox instrument master is unavailable for Futures LIMIT worker.");

      const stateResult=await serviceDb.from("paper_market_worker_state")
        .select("cursor_created_at,cursor_order_id")
        .eq("state_key","paper_futures_limit_orders").maybeSingle();
      if(stateResult.error)throw new Error("Futures LIMIT worker cursor could not be read.");
      let cursor=normalizeWorkerCursor(stateResult.data);
      const loadBatch=position=>{
        let query=serviceDb.from("paper_futures_orders")
          .select("order_id,user_id,instrument_key,trading_symbol,exchange,segment,side,product,order_type,status,quantity,filled_quantity,remaining_quantity,limit_price_paise,tick_size_paise,lot_size,expiry,expires_at,reserved_open_margin_paise,reserved_close_quantity,simulation_only,created_at")
          .eq("order_type","LIMIT").in("status",["PENDING","PARTIALLY_FILLED"])
          .eq("simulation_only",true).order("created_at",{ascending:true})
          .order("order_id",{ascending:true}).limit(maxOrders);
        if(position.createdAt&&position.orderId)
          query=query.or("created_at.gt."+position.createdAt+",and(created_at.eq."+position.createdAt+",order_id.gt."+position.orderId+")");
        return query;
      };
      let batch=await loadBatch(cursor);
      if(batch.error)throw new Error("Pending Futures LIMIT orders could not be scanned.");
      if(!(batch.data||[]).length&&(cursor.createdAt||cursor.orderId)){
        cursor={createdAt:null,orderId:null};
        const reset=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date(now()).toISOString()})
          .eq("state_key","paper_futures_limit_orders").eq("lease_token",leaseToken);
        if(reset.error)throw new Error("Futures LIMIT worker cursor could not be reset.");
        batch=await loadBatch(cursor);
        if(batch.error)throw new Error("Pending Futures LIMIT orders could not be rescanned.");
      }

      const orders=batch.data||[];
      summary.scanned=orders.length;
      const sessionCache=new Map();
      const getSession=async(exchange,at)=>{
        const key=exchange+":"+marketDateString(at);
        if(!sessionCache.has(key))sessionCache.set(key,await loadSession(serviceDb,exchange,at));
        return sessionCache.get(key);
      };

      const groups=[...groupOrdersByUser(orders).entries()];
      const processUserOrders=async([userId,userOrders])=>{
        if(getUpstoxUserCooldown(userId)){summary.failed+=userOrders.length;return;}
        let providerHealthy=false;
        try{
          const currentNow=now();
          const eligible=[];
          for(const order of userOrders){
            const session=await getSession(order.exchange,currentNow);
            const sessionOpen=isVerifiedSessionOpen(currentNow,session);
            const expiredByTime=Date.parse(order.expires_at)<=currentNow;
            if(expiredByTime||isContractExpired(order,currentNow)||!sessionOpen){
              const expired=await serviceDb.rpc("expire_paper_futures_limit_order",{p_order_id:order.order_id});
              if(expired?.error){
                if(["22023","23514","P0002"].includes(expired.error.code))summary.notEligible++;
                else{summary.failed++;console.warn("Futures LIMIT expiry RPC failed",{orderId:order.order_id,code:expired.error.code||"unknown"});}
              }else if(expired.data?.status==="EXPIRED"&&!expired.data.idempotent_replay)summary.expired++;
              else summary.notEligible++;
              continue;
            }
            const instrument=instruments.find(item=>item?.instrument_key===order.instrument_key);
            if(!isValidNseFuture(order,instrument)){
              summary.notEligible++;
              continue;
            }
            eligible.push({order,instrument,session});
          }
          if(!eligible.length)return;

          const {token}=await getUpstoxAccessToken(userId);
          const keys=[...new Set(eligible.map(x=>x.order.instrument_key))];
          const response=await fetchProvider(
            "https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")}),
            {headers:{Authorization:"Bearer "+token,Accept:"application/json"}}
          );
          const payload=await readProviderJson(response);
          if(!response.ok)throw upstoxHttpError(response);
          providerHealthy=true;
          clearUpstoxUserCooldown(userId);
          for(const {order} of eligible){
            const nowMs=now();
            let decision;
            try{
              decision=evaluateUpstoxRestDerivativeLimit(payload,order.instrument_key,{
                side:order.side,limitPricePaise:order.limit_price_paise,
                remainingQuantity:order.remaining_quantity,nowMs,maxAgeMs:15000
              });
            }catch(_){
              summary.notEligible++;
              continue;
            }
            if(!decision.eligible||decision.fillQuantity<1){
              summary.notEligible++;
              continue;
            }
            const grossPaise=decision.pricePaise*decision.fillQuantity;
            if(!Number.isSafeInteger(grossPaise)||grossPaise<1){
              summary.failed++;
              continue;
            }
            const fillsResult=await serviceDb.from("paper_futures_fills")
              .select("execution_id,fill_sequence,gross_paise")
              .eq("order_id",order.order_id)
              .order("fill_sequence",{ascending:true});
            if(fillsResult.error)throw new Error("Futures LIMIT execution ledger could not be read.");
            const fills=fillsResult.data||[];
            const executionId=crypto.createHash("sha256")
              .update([order.order_id,decision.timestampMs,decision.pricePaise,decision.fillQuantity,decision.bidPricePaise,decision.askPricePaise,decision.bidQuantity,decision.askQuantity].join("|"))
              .digest("hex");
            if(fills.some(fill=>fill.execution_id===executionId)){
              summary.notEligible++;
              continue;
            }
            const fillSequence=fills.reduce((max,fill)=>Math.max(max,Number(fill.fill_sequence)||0),0)+1;
            const chargesPaise=cumulativeFillCharges({
              fills,grossPaise,exchange:order.exchange,side:order.side
            });
            const result=await serviceDb.rpc("execute_paper_futures_limit_fill",{
              p_order_id:order.order_id,p_execution_id:executionId,
              p_fill_sequence:fillSequence,p_fill_quantity:decision.fillQuantity,
              p_execution_price_paise:decision.pricePaise,
              p_bid_price_paise:decision.bidPricePaise,p_ask_price_paise:decision.askPricePaise,
              p_bid_quantity:decision.bidQuantity,p_ask_quantity:decision.askQuantity,
              p_charges_paise:chargesPaise,p_quote_timestamp_ms:decision.timestampMs,p_now_ms:nowMs
            });
            if(result?.error){
              if(["23514","22023","P0002"].includes(result.error.code))summary.notEligible++;
              else{summary.failed++;console.warn("Futures LIMIT fill RPC failed",{orderId:order.order_id,code:result.error.code||"unknown"});}
            }else if(result?.data?.status==="FILLED"){
              summary.filled++;
            }else if(result?.data?.status==="PARTIALLY_FILLED"){
              summary.partial++;
            }else summary.notEligible++;
          }
        }catch(error){
          if(!providerHealthy)recordUpstoxUserFailure(userId,error);
          summary.failed+=userOrders.length;
          console.warn("Futures LIMIT user batch skipped",{userId,errorName:error?.name||"Error",status:error?.status||500,code:error?.code||"unknown"});
        }
      };
      for(let offset=0;offset<groups.length;offset+=5)
        await Promise.all(groups.slice(offset,offset+5).map(processUserOrders));

      if(orders.length){
        const last=orders[orders.length-1];
        const saved=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:last.created_at,cursor_order_id:last.order_id,updated_at:new Date(now()).toISOString()})
          .eq("state_key","paper_futures_limit_orders").eq("lease_token",leaseToken);
        if(saved.error)throw new Error("Futures LIMIT worker cursor could not be saved.");
      }else{
        const saved=await serviceDb.from("paper_market_worker_state")
          .update({cursor_created_at:null,cursor_order_id:null,updated_at:new Date(now()).toISOString()})
          .eq("state_key","paper_futures_limit_orders").eq("lease_token",leaseToken);
        if(saved.error)throw new Error("Futures LIMIT worker cursor could not be reset.");
      }
      return summary;
    }finally{
      const released=await serviceDb.rpc("release_paper_market_worker_lease",{
        p_state_key:"paper_futures_limit_orders",p_lease_token:leaseToken,p_now_ms:now()
      });
      if(released?.error)console.warn("Futures LIMIT worker lease release failed",{code:released.error.code||"unknown"});
    }
  };
}

module.exports={
  createPaperFuturesLimitWorker,isContractExpired,isValidNseFuture,cumulativeFillCharges,isVerifiedSessionOpen
};
