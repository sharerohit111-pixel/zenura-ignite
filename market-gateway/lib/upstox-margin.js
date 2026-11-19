"use strict";

function rupeesToPaise(value){
 if(typeof value!=="number"||!Number.isFinite(value)||value<0)return null;
 const paise=Math.round(value*100);
 return Number.isSafeInteger(paise)&&Math.abs(value*100-paise)<1e-7?paise:null;
}
function normalizeUpstoxMarginResponse(payload,instrumentKey){
 const fail=message=>{throw Object.assign(new Error(message),{status:502});};
 if(!payload||payload.status!=="success"||!payload.data||typeof payload.data!=="object"||Array.isArray(payload.data))
  fail("Upstox returned an invalid margin response.");
 const requiredMarginPaise=rupeesToPaise(payload.data.required_margin);
 if(requiredMarginPaise===null||requiredMarginPaise<1)
  fail("Upstox margin response is missing a valid required_margin.");
 const finalMarginPaise=payload.data.final_margin===undefined?null:rupeesToPaise(payload.data.final_margin);
 if(payload.data.final_margin!==undefined&&finalMarginPaise===null)
  fail("Upstox returned an invalid final_margin.");
 const rows=Array.isArray(payload.data.margins)?payload.data.margins:[];
 if(payload.data.margins!==undefined&&!Array.isArray(payload.data.margins))
  fail("Upstox returned an invalid margin components list.");
 if(rows.some(row=>!row||typeof row!=="object"||Array.isArray(row)))
  fail("Upstox returned a malformed margin component row.");
 if(rows.some(row=>row&&typeof row==="object"&&typeof row.instrument_key==="string"&&row.instrument_key!==instrumentKey))
  fail("Upstox margin response contains a different instrument.");
 const matching=rows.filter(row=>row&&typeof row==="object"&&(!row.instrument_key||row.instrument_key===instrumentKey));
 const components=matching.slice(0,10).map(row=>{
  const out={};
  for(const key of ["span","exposure","option_premium","net_buy_premium","total_margin","tender","delivery"])
   if(row[key]!==undefined){const amount=rupeesToPaise(row[key]);if(amount===null)fail("Upstox returned an invalid margin component.");const normalizedKey=key.replace(/_([a-z])/g,(_match,char)=>char.toUpperCase());out[normalizedKey+"Paise"]=amount;}
  return out;
 });
 return {requiredMarginPaise,finalMarginPaise,components,source:"upstox_v2_charges_margin",instrumentKey};
}
module.exports={rupeesToPaise,normalizeUpstoxMarginResponse};
