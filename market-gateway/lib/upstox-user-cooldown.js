"use strict";

const MAX_USERS=5000;
const AUTH_COOLDOWN_MS=5*60*1000;
const RATE_LIMIT_FALLBACK_MS=5*1000;
const TRANSIENT_BASE_MS=5*1000;
const TRANSIENT_MAX_MS=60*1000;
const MAX_RATE_LIMIT_MS=5*60*1000;
const states=new Map();

function validUserId(userId){
  return typeof userId==="string"&&userId.trim().length>0;
}
function boundedStore(userId,state){
  if(states.has(userId))states.delete(userId);
  states.set(userId,state);
  while(states.size>MAX_USERS){
    const oldest=states.keys().next().value;
    states.delete(oldest);
  }
}
function getUpstoxUserCooldown(userId,nowMs=Date.now()){
  if(!validUserId(userId)||!Number.isSafeInteger(nowMs)||nowMs<0)return null;
  const state=states.get(userId);
  if(!state)return null;
  if(state.untilMs<=nowMs){
    states.delete(userId);
    return null;
  }
  return Object.freeze({
    untilMs:state.untilMs,
    retryAfterMs:state.untilMs-nowMs,
    kind:state.kind,
    failures:state.failures
  });
}
function recordUpstoxUserFailure(userId,error,nowMs=Date.now()){
  if(!validUserId(userId)||!Number.isSafeInteger(nowMs)||nowMs<0)return null;
  const previous=states.get(userId);
  const failures=Math.min(12,(previous?.failures||0)+1);
  const status=Number(error?.status);
  let kind,delayMs;
  if(status===401||error?.code==="upstox_reconnect_required"){
    kind="auth";
    delayMs=AUTH_COOLDOWN_MS;
  }else if(status===429||error?.code==="upstox_rate_limited"){
    kind="rate_limit";
    const supplied=Number(error?.retryAfterSeconds);
    delayMs=Number.isFinite(supplied)&&supplied>0
      ?Math.min(MAX_RATE_LIMIT_MS,Math.ceil(supplied*1000))
      :Math.min(MAX_RATE_LIMIT_MS,RATE_LIMIT_FALLBACK_MS*(2**Math.min(failures-1,6)));
  }else if(status>=500||!Number.isFinite(status)||status===0){
    kind="transient";
    delayMs=Math.min(TRANSIENT_MAX_MS,TRANSIENT_BASE_MS*(2**Math.min(failures-1,4)));
  }else{
    return getUpstoxUserCooldown(userId,nowMs);
  }
  boundedStore(userId,{untilMs:nowMs+delayMs,kind,failures});
  return getUpstoxUserCooldown(userId,nowMs);
}
function clearUpstoxUserCooldown(userId){
  if(!validUserId(userId))return false;
  return states.delete(userId);
}
function clearAllUpstoxUserCooldownsForTests(){
  states.clear();
}

module.exports={
  getUpstoxUserCooldown,
  recordUpstoxUserFailure,
  clearUpstoxUserCooldown,
  clearAllUpstoxUserCooldownsForTests,
  AUTH_COOLDOWN_MS,
  RATE_LIMIT_FALLBACK_MS,
  TRANSIENT_BASE_MS,
  TRANSIENT_MAX_MS,
  MAX_RATE_LIMIT_MS,
  MAX_USERS
};
