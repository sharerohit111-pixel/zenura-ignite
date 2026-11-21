"use strict";

function createLeaseHeartbeat({renew,onRenewed=()=>{},onLost=()=>{},onError=()=>{},intervalMs=20000,schedule=setInterval,cancel=clearInterval}){
 if(typeof renew!=="function"||typeof onRenewed!=="function"||typeof onLost!=="function"||typeof onError!=="function"||!Number.isSafeInteger(intervalMs)||intervalMs<1||typeof schedule!=="function"||typeof cancel!=="function")throw new TypeError("Invalid lease heartbeat configuration");
 let timer=null,stopped=false,inFlight=false;
 const stop=()=>{if(stopped)return false;stopped=true;if(timer!==null)cancel(timer);timer=null;return true;};
 const tick=async()=>{
  if(stopped||inFlight)return;
  inFlight=true;
  try{
   const renewed=await renew();
   if(stopped)return;
   if(renewed!==true){stop();onLost();return;}
   onRenewed();
  }catch(error){if(!stopped){stop();onError(error);}}
  finally{inFlight=false;}
 };
 timer=schedule(()=>{void tick();},intervalMs);
 return {stop,tick};
}
module.exports={createLeaseHeartbeat};
