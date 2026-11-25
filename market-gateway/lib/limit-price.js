"use strict";

function parseLimitPricePaise(rawPrice){
  const value=String(rawPrice??"");
  if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(value))return null;
  const paise=Math.round(Number(value)*100);
  return Number.isSafeInteger(paise)&&paise>0?paise:null;
}

module.exports={parseLimitPricePaise};
