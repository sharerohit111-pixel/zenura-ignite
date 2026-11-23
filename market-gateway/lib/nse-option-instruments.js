"use strict";

function isNseOptionContract(item){
  return !!item&&item.exchange==="NSE"&&item.segment==="NSE_FO"
    &&(item.instrument_type==="CE"||item.instrument_type==="PE");
}

function filterNseOptionContracts(items){
  if(!Array.isArray(items))return [];
  return items.filter(isNseOptionContract);
}

module.exports={isNseOptionContract,filterNseOptionContracts};
