"use strict";

function groupAlertsByUser(alerts){
 const groups=new Map();
 for(const alert of alerts||[]){
  if(!alert||typeof alert.user_id!=="string"||typeof alert.instrument_key!=="string"||typeof alert.alert_id!=="string")continue;
  if(!groups.has(alert.user_id))groups.set(alert.user_id,[]);
  groups.get(alert.user_id).push(alert);
 }
 return groups;
}
function createPriceAlertWorker({serviceDb,getUpstoxAccessToken,fetchProvider,readProviderJson,normalizeProviderQuote,now=Date.now}={}){
 for(const [name,fn] of Object.entries({getUpstoxAccessToken,fetchProvider,readProviderJson,normalizeProviderQuote}))
  if(typeof fn!=="function")throw new TypeError(name+" dependency is required");
 if(!serviceDb||typeof serviceDb.from!=="function"||typeof serviceDb.rpc!=="function")throw new TypeError("serviceDb is required");
 async function run({maxAlerts=500,maxUsersPerCycle=20}={}){
  if(!Number.isInteger(maxAlerts)||maxAlerts<1||maxAlerts>1000||!Number.isInteger(maxUsersPerCycle)||maxUsersPerCycle<1||maxUsersPerCycle>50)
   throw new TypeError("Price alert worker bounds are invalid");
  const result={scanned:0,users:0,observed:0,triggered:0,stale:0,failed:0};
  const loaded=await serviceDb.from("s_trade_price_alerts")
   .select("alert_id,user_id,instrument_key,display_symbol,condition,target_price")
   .eq("active",true).order("created_at",{ascending:true}).limit(maxAlerts);
  if(loaded.error)throw new Error("Active price alerts could not be scanned");
  const groups=[...groupAlertsByUser(loaded.data||[]).entries()].slice(0,maxUsersPerCycle);
  result.scanned=(loaded.data||[]).length;result.users=groups.length;
  for(let offset=0;offset<groups.length;offset+=5){
   await Promise.all(groups.slice(offset,offset+5).map(async([userId,alerts])=>{
    try{
     const {token}=await getUpstoxAccessToken(userId);
     const unique=[...new Set(alerts.map(a=>a.instrument_key))];
     for(let start=0;start<unique.length;start+=100){
      const keys=unique.slice(start,start+100);
      const url="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:keys.join(",")});
      const response=await fetchProvider(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
      if(!response.ok)throw new Error("Upstox quote request failed");
      const payload=await readProviderJson(response),entries=Object.values(payload?.data||{});
      for(const alert of alerts.filter(a=>keys.includes(a.instrument_key))){
       try{
        const entry=entries.find(item=>item?.instrument_token===alert.instrument_key);
        const quote=normalizeProviderQuote(entry,alert.instrument_key,{maxAgeMs:15000,nowMs:now()});
        if(!quote||!Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<=0){result.stale++;continue;}
        const evaluated=await serviceDb.rpc("s_trade_evaluate_price_alert",{
         p_alert_id:alert.alert_id,p_observed_price:quote.pricePaise/100
        });
        if(evaluated?.error)throw new Error("Price alert evaluation failed");
        result.observed++;if(evaluated.data===true)result.triggered++;
       }catch(error){if(error?.name==="StaleQuoteError")result.stale++;else result.failed++;}
      }
     }
    }catch(_error){result.failed+=alerts.length;}
   }));
  }
  return result;
 }
 return Object.freeze({run});
}
module.exports={groupAlertsByUser,createPriceAlertWorker};
