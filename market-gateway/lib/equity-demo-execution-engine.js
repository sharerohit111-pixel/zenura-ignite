"use strict";

(function(){
/*
 * Test/demo-only deterministic cash-equity execution simulator.
 * This module is deliberately not imported by supabase-server.js or any live route.
 * All prices and displayed liquidity are synthetic; fees/taxes are not modelled.
 */
const MAX_QUANTITY=1000000;
const PRODUCTS=new Set(["DELIVERY","INTRADAY"]);
const SIDES=new Set(["BUY","SELL"]);
const TYPES=new Set(["MARKET","LIMIT"]);
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
function safeProduct(a,b){const n=a*b;if(!Number.isSafeInteger(n)||n<0)fail("DEMO_AMOUNT_OUT_OF_RANGE",409);return n;}
function validateFixture(fixture){
  if(!fixture||fixture.schemaVersion!=="1.0.0"||fixture.mode!=="MOCK"||fixture.simulated!==true||
    fixture.meta?.source!=="SYNTHETIC_FIXTURE"||fixture.meta?.exchange!=="NONE"||
    fixture.meta?.provider!=="MOCK"||fixture.meta?.fees!=="NOT_MODELED"||
    typeof fixture.asOf!=="string"||!Number.isFinite(Date.parse(fixture.asOf)))fail("INVALID_EQUITY_DEMO_FIXTURE",500);
  const instrument=fixture.data?.instrument,book=fixture.data?.orderBook;
  if(!instrument||typeof instrument.instrumentKey!=="string"||!instrument.instrumentKey.startsWith("MOCK|NSE|EQ|")||
    typeof instrument.symbol!=="string"||!instrument.symbol.startsWith("MOCK")||
    !Number.isSafeInteger(instrument.tickSizePaise)||instrument.tickSizePaise<1||
    !Number.isSafeInteger(instrument.markPricePaise)||instrument.markPricePaise<1||instrument.markPricePaise%instrument.tickSizePaise!==0||
    !Array.isArray(book?.asks)||!book.asks.length||!Array.isArray(book?.bids)||!book.bids.length)fail("INVALID_EQUITY_DEMO_FIXTURE",500);
  for(const [side,levels] of Object.entries(book)){
    let previous=side==="asks"?0:Number.MAX_SAFE_INTEGER;
    for(const level of levels){
      if(!Number.isSafeInteger(level.pricePaise)||level.pricePaise<1||level.pricePaise%instrument.tickSizePaise!==0||
        !Number.isSafeInteger(level.quantity)||level.quantity<1||
        (side==="asks"?level.pricePaise<previous:level.pricePaise>previous))fail("INVALID_EQUITY_DEMO_ORDER_BOOK",500);
      previous=level.pricePaise;
    }
  }
  if(book.bids[0].pricePaise>=book.asks[0].pricePaise)fail("CROSSED_EQUITY_DEMO_ORDER_BOOK",500);
  if(instrument.markPricePaise<book.bids[0].pricePaise||instrument.markPricePaise>book.asks[0].pricePaise)fail("INVALID_EQUITY_DEMO_MARK_PRICE",500);
  return fixture;
}
function normalizeAccount(account){
  if(!account||account.currency!=="INR"||!Number.isSafeInteger(account.startingCapitalPaise)||account.startingCapitalPaise<1||
    !Number.isSafeInteger(account.cashBalancePaise)||account.cashBalancePaise<0||
    !Number.isSafeInteger(account.blockedFundsPaise)||account.blockedFundsPaise<0||
    account.blockedFundsPaise>account.cashBalancePaise)fail("INVALID_EQUITY_DEMO_ACCOUNT",409);
  const positions=account.positions||{},intradayPositions=account.intradayPositions||{};
  for(const map of [positions,intradayPositions]){
    if(!map||typeof map!=="object"||Array.isArray(map))fail("INVALID_EQUITY_DEMO_POSITIONS",409);
    for(const p of Object.values(map)){
      if(!p||!Number.isSafeInteger(p.quantity)||p.quantity<0||!Number.isSafeInteger(p.costBasisPaise)||p.costBasisPaise<0||
        !Number.isSafeInteger(p.reservedQuantity||0)||(p.reservedQuantity||0)<0||(p.reservedQuantity||0)>p.quantity||
        (p.quantity===0&&p.costBasisPaise!==0))fail("INVALID_EQUITY_DEMO_POSITION",409);
    }
  }
  const result={...clone(account),positions:clone(positions),intradayPositions:clone(intradayPositions)};
  result.availableFundsPaise=result.cashBalancePaise-result.blockedFundsPaise;
  result.realizedPnlPaise=Number.isSafeInteger(result.realizedPnlPaise)?result.realizedPnlPaise:0;
  return result;
}
function fingerprint(request){
  return JSON.stringify({instrumentKey:request.instrumentKey,side:request.side,orderType:request.orderType,
    product:request.product,quantity:request.quantity,limitPricePaise:request.limitPricePaise??null});
}
function createEquityDemoExecutionEngine({fixture,account,env=(typeof process!=="undefined"?process.env:{})}={}){
  if(env?.NODE_ENV==="production")fail("EQUITY_DEMO_EXECUTION_DISABLED_IN_PRODUCTION",403);
  validateFixture(fixture);
  const instrument=fixture.data.instrument;
  const state={account:normalizeAccount(account),orders:new Map(),idempotency:new Map(),fills:[],executions:new Map(),
    book:{asks:clone(fixture.data.orderBook.asks),bids:clone(fixture.data.orderBook.bids),askIndex:0,bidIndex:0}};
  function positionMap(product){return product==="INTRADAY"?state.account.intradayPositions:state.account.positions;}
  function updateAvailable(){state.account.availableFundsPaise=state.account.cashBalancePaise-state.account.blockedFundsPaise;}
  function orderView(order){return clone(order);}
  function submitOrder(input){
    if(!input||typeof input!=="object"||Array.isArray(input))fail("INVALID_DEMO_ORDER");
    const request={instrumentKey:input.instrumentKey,side:input.side,orderType:input.orderType,product:input.product,
      quantity:input.quantity,limitPricePaise:input.limitPricePaise};
    if(request.instrumentKey!==instrument.instrumentKey||!SIDES.has(request.side)||!TYPES.has(request.orderType)||
      !PRODUCTS.has(request.product)||!Number.isSafeInteger(request.quantity)||request.quantity<1||request.quantity>MAX_QUANTITY)
      fail("INVALID_DEMO_ORDER");
    if((request.orderType==="LIMIT"&&(!Number.isSafeInteger(request.limitPricePaise)||request.limitPricePaise<1||
      request.limitPricePaise%instrument.tickSizePaise!==0))||
      (request.orderType==="MARKET"&&request.limitPricePaise!==undefined))fail("INVALID_DEMO_ORDER_PRICE");
    const key=input.idempotencyKey;
    if(typeof key!=="string"||!/^[A-Za-z0-9_-]{8,80}$/.test(key))fail("INVALID_DEMO_IDEMPOTENCY_KEY");
    const hash=fingerprint(request),prior=state.idempotency.get(key);
    if(prior){if(prior.fingerprint!==hash)fail("DEMO_IDEMPOTENCY_KEY_REUSED",409);return orderView(state.orders.get(prior.orderId));}
    let reserveCashPaise=0;
    if(request.side==="BUY"){
      const reservePrice=request.orderType==="LIMIT"?request.limitPricePaise:state.book.asks.at(-1).pricePaise;
      reserveCashPaise=safeProduct(reservePrice,request.quantity);
      if(reserveCashPaise>state.account.availableFundsPaise)fail("INSUFFICIENT_DEMO_CASH",409);
    }else{
      const p=positionMap(request.product)[request.instrumentKey];
      if(!p||request.quantity>p.quantity-(p.reservedQuantity||0))fail("INSUFFICIENT_DEMO_UNRESERVED_SHARES",409);
      p.reservedQuantity=(p.reservedQuantity||0)+request.quantity;
    }
    const orderId="DEMO-EQ-"+key;
    const order={orderId,idempotencyKey:key,instrumentKey:request.instrumentKey,symbol:instrument.symbol,
      side:request.side,orderType:request.orderType,product:request.product,quantity:request.quantity,
      filledQuantity:0,remainingQuantity:request.quantity,averagePricePaise:0,grossValuePaise:0,
      realizedPnlPaise:0,status:"PENDING",reservedCashPaise:reserveCashPaise,reservedShareQuantity:request.side==="SELL"?request.quantity:0,
      limitPricePaise:request.limitPricePaise??null,simulationOnly:true,source:"SYNTHETIC_FIXTURE",createdAt:fixture.asOf,
      updatedAt:fixture.asOf};
    state.orders.set(orderId,order);state.idempotency.set(key,{fingerprint:hash,orderId});
    state.account.blockedFundsPaise+=reserveCashPaise;updateAvailable();
    return orderView(order);
  }
  function matchNext(orderId,options={}){
    const order=state.orders.get(orderId);if(!order)fail("DEMO_ORDER_NOT_FOUND",404);
    if(!options||typeof options!=="object"||Array.isArray(options))fail("INVALID_DEMO_EXECUTION_OPTIONS");
    const executionId=options.executionId;
    if(executionId!==undefined){
      if(typeof executionId!=="string"||!/^[A-Za-z0-9_-]{8,80}$/.test(executionId))fail("INVALID_DEMO_EXECUTION_ID");
      const prior=state.executions.get(executionId);
      if(prior){if(prior.orderId!==orderId)fail("DEMO_EXECUTION_ID_REUSED",409);return clone(prior.result);}
    }
    if(order.status==="FILLED"||order.status==="CANCELLED")return {matched:false,reason:"ORDER_NOT_OPEN",order:orderView(order),fill:null};
    const sideBook=order.side==="BUY"?state.book.asks:state.book.bids;
    const indexKey=order.side==="BUY"?"askIndex":"bidIndex";
    while(state.book[indexKey]<sideBook.length&&sideBook[state.book[indexKey]].quantity===0)state.book[indexKey]++;
    if(state.book[indexKey]>=sideBook.length)return {matched:false,reason:"NO_SYNTHETIC_LIQUIDITY",order:orderView(order),fill:null};
    const level=sideBook[state.book[indexKey]];
    const marketable=order.orderType==="MARKET"||(order.side==="BUY"?level.pricePaise<=order.limitPricePaise:level.pricePaise>=order.limitPricePaise);
    if(!marketable)return {matched:false,reason:"LIMIT_NOT_MARKETABLE",order:orderView(order),fill:null};
    const quantity=Math.min(order.remainingQuantity,level.quantity),gross=safeProduct(level.pricePaise,quantity);
    const fillSequence=state.fills.length+1,fillId=order.orderId+"-F"+String(fillSequence).padStart(4,"0");
    const timestamp=new Date(Date.parse(fixture.asOf)+fillSequence*1000).toISOString();
    if(order.side==="BUY"){
      state.account.cashBalancePaise-=gross;
      state.account.blockedFundsPaise-=safeProduct(order.orderType==="LIMIT"?order.limitPricePaise:state.book.asks.at(-1).pricePaise,quantity);
      const map=positionMap(order.product),old=map[order.instrumentKey]||{quantity:0,costBasisPaise:0,averagePricePaise:0,reservedQuantity:0};
      old.quantity+=quantity;old.costBasisPaise+=gross;old.averagePricePaise=Math.round(old.costBasisPaise/old.quantity);old.investedValuePaise=old.costBasisPaise;
      map[order.instrumentKey]=old;
    }else{
      const nextCash=state.account.cashBalancePaise+gross;
      if(!Number.isSafeInteger(nextCash))fail("DEMO_AMOUNT_OUT_OF_RANGE",409);
      state.account.cashBalancePaise=nextCash;
      const map=positionMap(order.product),p=map[order.instrumentKey];
      const allocatedCost=quantity===p.quantity?p.costBasisPaise:Math.round(p.costBasisPaise*quantity/p.quantity);
      const oldQuantity=p.quantity;p.quantity-=quantity;p.costBasisPaise-=allocatedCost;p.averagePricePaise=p.quantity?Math.round(p.costBasisPaise/p.quantity):0;
      p.investedValuePaise=p.costBasisPaise;p.reservedQuantity-=quantity;
      const realized=gross-allocatedCost;order.realizedPnlPaise+=realized;state.account.realizedPnlPaise+=realized;
      if(p.quantity===0)delete map[order.instrumentKey];
      order._lastFillRealizedPnlPaise=realized;
    }
    level.quantity-=quantity;
    order.filledQuantity+=quantity;order.remainingQuantity-=quantity;order.grossValuePaise+=gross;
    order.averagePricePaise=Math.round(order.grossValuePaise/order.filledQuantity);
    order.reservedCashPaise-=order.side==="BUY"?safeProduct(order.orderType==="LIMIT"?order.limitPricePaise:state.book.asks.at(-1).pricePaise,quantity):0;
    order.reservedShareQuantity-=order.side==="SELL"?quantity:0;
    order.status=order.remainingQuantity===0?"FILLED":"PARTIALLY_FILLED";order.updatedAt=timestamp;
    const fill={fillId,executionId:fillId,orderId:order.orderId,instrumentKey:order.instrumentKey,symbol:order.symbol,
      side:order.side,product:order.product,quantity,pricePaise:level.pricePaise,grossValuePaise:gross,
      realizedPnlPaise:order.side==="SELL"?order._lastFillRealizedPnlPaise:0,
      filledAt:timestamp,sequence:fillSequence,simulationOnly:true,source:"SYNTHETIC_FIXTURE"};
    delete order._lastFillRealizedPnlPaise;
    state.fills.push(fill);updateAvailable();
    const result={matched:true,reason:null,order:orderView(order),fill:clone(fill)};
    if(executionId)state.executions.set(executionId,{orderId,result:clone(result)});
    return result;
  }
  function cancelOrder(orderId){
    const order=state.orders.get(orderId);if(!order)fail("DEMO_ORDER_NOT_FOUND",404);
    if(order.status==="CANCELLED")return {cancelled:true,order:orderView(order),releasedCashPaise:0,releasedShareQuantity:0};
    if(order.status==="FILLED")return {cancelled:false,reason:"ORDER_ALREADY_FILLED",order:orderView(order),releasedCashPaise:0,releasedShareQuantity:0};
    const releasedCashPaise=order.reservedCashPaise,releasedShareQuantity=order.reservedShareQuantity;
    state.account.blockedFundsPaise-=releasedCashPaise;order.reservedCashPaise=0;order.reservedShareQuantity=0;
    if(order.side==="SELL"&&releasedShareQuantity>0){
      const p=positionMap(order.product)[order.instrumentKey];
      if(!p||p.reservedQuantity<releasedShareQuantity)fail("DEMO_RESERVATION_INVARIANT_BROKEN",500);
      p.reservedQuantity-=releasedShareQuantity;
    }
    order.status="CANCELLED";order.updatedAt=new Date(Date.parse(fixture.asOf)+(state.fills.length+1)*1000).toISOString();
    updateAvailable();
    return {cancelled:true,order:orderView(order),releasedCashPaise,releasedShareQuantity};
  }
  function snapshot(){
    const delivery=state.account.positions[instrument.instrumentKey]||{quantity:0,costBasisPaise:0};
    const intraday=state.account.intradayPositions[instrument.instrumentKey]||{quantity:0,costBasisPaise:0};
    const quantity=delivery.quantity+intraday.quantity;
    const costBasisPaise=delivery.costBasisPaise+intraday.costBasisPaise;
    const marketValuePaise=safeProduct(instrument.markPricePaise,quantity);
    const unrealizedPnlPaise=marketValuePaise-costBasisPaise;
    const totalPnlPaise=state.account.realizedPnlPaise+unrealizedPnlPaise;
    return clone({mode:"MOCK",simulated:true,source:"SYNTHETIC_FIXTURE",fees:"NOT_MODELED",
      valuation:{instrumentKey:instrument.instrumentKey,markPricePaise:instrument.markPricePaise,quantity,costBasisPaise,marketValuePaise,unrealizedPnlPaise,totalPnlPaise},
      account:state.account,orders:[...state.orders.values()],fills:state.fills,
      orderBook:{asks:state.book.asks,bids:state.book.bids}});
  }
  return Object.freeze({submitOrder,matchNext,cancelOrder,getOrder:id=>{const o=state.orders.get(id);return o?orderView(o):null;},
    getFillReceipts:orderId=>clone(state.fills.filter(f=>!orderId||f.orderId===orderId)),snapshot});
}
const api={createEquityDemoExecutionEngine,validateEquityDemoFixture:validateFixture};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window!=="undefined")window.ZenuraEquityDemoEngine=api;

})();
