"use strict";

function normalizeEquityTickSizePaise(value){
  if((typeof value!=="number"&&typeof value!=="string")||String(value).trim()==="")return null;
  const numeric=Number(value);
  if(!Number.isFinite(numeric)||numeric<=0)return null;
  // Upstox instrument-master tick_size is commonly expressed in paise (5),
  // while legacy fixtures may express rupees (0.05).
  const paise=numeric<1?numeric*100:numeric;
  const rounded=Math.round(paise);
  return Number.isSafeInteger(rounded)&&rounded>0&&Math.abs(paise-rounded)<1e-7?rounded:null;
}

function isEquityExecutionPriceOnTick(pricePaise,tickSizePaise){
  return Number.isSafeInteger(pricePaise)&&pricePaise>0
    &&Number.isSafeInteger(tickSizePaise)&&tickSizePaise>0
    &&pricePaise%tickSizePaise===0;
}

module.exports={normalizeEquityTickSizePaise,isEquityExecutionPriceOnTick};
