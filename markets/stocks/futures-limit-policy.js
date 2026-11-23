(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.ZenuraFuturesLimitPolicy=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function normalizeTickSizePaise(value){
    const number=Number(value);
    if(!Number.isFinite(number)||number<=0)return null;
    const paise=number<1?number*100:number;
    return Number.isSafeInteger(Math.round(paise))&&Math.abs(paise-Math.round(paise))<1e-7&&paise>0?Math.round(paise):null;
  }
  function parseLimitPricePaise(value,tickSizePaise){
    if(typeof value!=="string"||!/^[0-9]{1,8}(?:\.[0-9]{1,2})?$/.test(value.trim()))return null;
    const price=Number(value.trim());
    const paise=Math.round(price*100);
    if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(paise)||paise<1
       ||!Number.isSafeInteger(tickSizePaise)||tickSizePaise<1||paise%tickSizePaise!==0)return null;
    return paise;
  }
  function isSupportedNseFuture(instrument){
    return !!instrument&&instrument.exchange==="NSE"&&instrument.segment==="NSE_FO"
      &&instrument.instrument_type==="FUT"
      &&typeof instrument.instrument_key==="string"&&instrument.instrument_key.length>0
      &&typeof instrument.trading_symbol==="string"&&instrument.trading_symbol.length>0
      &&Number.isSafeInteger(Number(instrument.lot_size))&&Number(instrument.lot_size)>0
      &&normalizeTickSizePaise(instrument.tick_size)!==null;
  }
  function isEnabled(health){
    return health?.futuresLimitSubmissionEnabled===true&&health?.futuresLimitWorker?.enabled===true;
  }
  function validLots(value){
    return Number.isSafeInteger(value)&&value>=1&&value<=10000;
  }
  function fingerprint({instrumentKey,side,lots,product,limitPricePaise}){
    if(typeof instrumentKey!=="string"||!["BUY","SELL"].includes(side)
       ||!validLots(lots)||!["INTRADAY","DELIVERY"].includes(product)
       ||!Number.isSafeInteger(limitPricePaise)||limitPricePaise<1)return null;
    return JSON.stringify({instrument_key:instrumentKey,side,lots,product,limit_price_paise:limitPricePaise,order_type:"LIMIT"});
  }
  return Object.freeze({normalizeTickSizePaise,parseLimitPricePaise,isSupportedNseFuture,isEnabled,validLots,fingerprint});
});
