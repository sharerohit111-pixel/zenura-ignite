"use strict";
function reserveUserStream(registry,uid){
  if(!(registry instanceof Map)||typeof uid!=="string"||!uid)return null;
  if(registry.has(uid))return null;
  const reservation=Symbol("market-stream");
  registry.set(uid,reservation);
  return reservation;
}
function releaseUserStream(registry,uid,reservation){
  if(!(registry instanceof Map)||!reservation||registry.get(uid)!==reservation)return false;
  return registry.delete(uid);
}
module.exports={reserveUserStream,releaseUserStream};
