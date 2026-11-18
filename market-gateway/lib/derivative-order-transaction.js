"use strict";

const {validateDerivativeContract}=require("./derivative-contract");
const {applyDerivativeFill}=require("./derivative-position");
const {makeOrderId,makeOrderFingerprint,assertIdempotentReplay}=require("./order-idempotency");
const {calculateLongOptionTradeCharges}=require("./trading-charges");

const MAX_QUOTE_AGE_MS=15_000;

/**
 * Atomically records a long CE/PE BUY or SELL-to-close in the shared Indian paper account.
 * Opening shorts, futures, margin borrowing and live orders remain disabled.
 *
 * instrument and quote must be loaded by trusted server code from verified
 * provider data. Never pass client-supplied instrument metadata or prices here.
 */
async function executeLongOptionTransaction({
  db,accountRef,orderRef,uid,idempotencyKey,instrument,quote,lots,side="BUY",
  serverTimestamp,now=Date.now()
}){
  const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
  if(!db||typeof db.runTransaction!=="function"||!accountRef||accountRef.id!==uid||
     !orderRef||typeof uid!=="string"||!uid||typeof serverTimestamp!=="function")
    throw new TypeError("Derivative transaction identity or dependencies are invalid.");
  if(!["BUY","SELL"].includes(side))fail("Option order side must be BUY or SELL.",400);
  if(!["CE","PE"].includes(instrument?.instrument_type))
    fail("Only long CE/PE BUY and SELL-to-close transactions are enabled in this phase.",400);
  if(!Number.isSafeInteger(now)||now<0)fail("Current time is invalid.",400);
  if(!quote||quote.instrumentKey!==instrument.instrument_key||
     !Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1||
     !Number.isSafeInteger(quote.observedAtMs)||quote.observedAtMs>now||
     now-quote.observedAtMs>MAX_QUOTE_AGE_MS)
    fail("A matching fresh provider quote is required. Order rejected.");
  const contract=validateDerivativeContract(instrument,{lots,pricePaise:quote.pricePaise,now});
  const orderId=makeOrderId(uid,idempotencyKey);
  if(orderRef.id!==orderId)fail("Derivative order reference does not match the idempotency key.",400);
  const requestFingerprint=makeOrderFingerprint({
    instrumentKey:contract.instrumentKey,side,quantity:contract.quantity
  });
  const charges=calculateLongOptionTradeCharges({grossPaise:contract.contractValuePaise,exchange:contract.exchange,side});
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,existingOrder]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(existingOrder.exists){
      const prior=existingOrder.data();
      assertIdempotentReplay(prior,requestFingerprint);
      const current=accountSnap.exists?accountSnap.data():{};
      result={orderId,order:prior,cashPaise:current.cashPaise,realizedPnlPaise:current.realizedPnlPaise??0,idempotentReplay:true,simulationOnly:true};
      return;
    }
    if(!accountSnap.exists)fail("Derivative paper account is not initialized.",409);
    const account=accountSnap.data();
    if(!Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||
       !Number.isSafeInteger(account.realizedPnlPaise??0)||
       !Number.isSafeInteger(account.version)||account.version<1||
       account.version>=Number.MAX_SAFE_INTEGER||
       (account.reservedMarginPaise!==undefined&&account.reservedMarginPaise!==0))
      fail("Derivative paper account contains invalid or unsupported balance data.",409);
    const derivativePositions=account.derivativePositions&&typeof account.derivativePositions==="object"&&!Array.isArray(account.derivativePositions)?{...account.derivativePositions}:{};
    const priorPosition=derivativePositions[contract.instrumentKey]||{netQuantity:0,averagePricePaise:0};
    if(!Number.isSafeInteger(priorPosition.netQuantity)||priorPosition.netQuantity<0)
      fail("Stored short or malformed option positions are not supported by this paper simulator.",409);
    if(priorPosition.instrumentType&&priorPosition.instrumentType!==contract.instrumentType)
      fail("Stored derivative position type does not match the verified contract.",409);
    if(side==="SELL"&&(!Number.isSafeInteger(priorPosition.netQuantity)||priorPosition.netQuantity<contract.quantity))
      fail("SELL is allowed only to close an existing long option position; short options are disabled.",409);
    const fill=applyDerivativeFill({
      instrumentType:contract.instrumentType,side,quantity:contract.quantity,
      pricePaise:quote.pricePaise,position:priorPosition,now
    });
    const priorCostBasisPaise=priorPosition.costBasisPaise===undefined
      ?priorPosition.netQuantity*priorPosition.averagePricePaise
      :priorPosition.costBasisPaise;
    if(!Number.isSafeInteger(priorCostBasisPaise)||priorCostBasisPaise<0||
       (priorPosition.netQuantity>0&&priorCostBasisPaise<1))
      fail("Stored option cost basis is invalid.",409);
    let averagePricePaise=fill.averagePricePaise;
    let costBasisPaise=0;
    let orderRealizedPnlPaise=0;
    if(side==="BUY"){
      costBasisPaise=priorCostBasisPaise+contract.contractValuePaise+charges.totalChargesPaise;
      if(!Number.isSafeInteger(costBasisPaise)||fill.netQuantity<1)
        fail("Option position cost basis exceeds supported calculation limits.",409);
      averagePricePaise=Math.round(costBasisPaise/fill.netQuantity);
    }else{
      const closedCostBasisPaise=contract.quantity===priorPosition.netQuantity
        ?priorCostBasisPaise
        :Number((BigInt(priorCostBasisPaise)*BigInt(contract.quantity)+BigInt(Math.floor(priorPosition.netQuantity/2)))/BigInt(priorPosition.netQuantity));
      costBasisPaise=priorCostBasisPaise-closedCostBasisPaise;
      orderRealizedPnlPaise=contract.contractValuePaise-closedCostBasisPaise-charges.totalChargesPaise;
      if(fill.netQuantity>0)averagePricePaise=Math.round(costBasisPaise/fill.netQuantity);
    }
    if(!Number.isSafeInteger(costBasisPaise)||costBasisPaise<0||
       !Number.isSafeInteger(orderRealizedPnlPaise))
      fail("Net realized option P&L or cost basis exceeds supported calculation limits.",409);
    const cashPaise=account.cashPaise+fill.cashDeltaPaise-charges.totalChargesPaise;
    if(!Number.isSafeInteger(cashPaise)||cashPaise<0)
      fail("Insufficient derivative paper cash for this option premium.",409);
    if(fill.netQuantity>0)derivativePositions[contract.instrumentKey]={
      instrumentType:contract.instrumentType,netQuantity:fill.netQuantity,
      averagePricePaise,costBasisPaise,exchange:contract.exchange,
      segment:contract.segment,expiry:contract.expiry,lotSize:contract.lotSize
    };
    else delete derivativePositions[contract.instrumentKey];
    const realizedPnlPaise=(account.realizedPnlPaise??0)+orderRealizedPnlPaise;
    if(!Number.isSafeInteger(realizedPnlPaise))fail("Derivative realized P&L exceeds safe calculation limits.",409);
    const storedOrder={
      uid,requestFingerprint,instrumentKey:contract.instrumentKey,
      tradingSymbol:instrument.trading_symbol,exchange:contract.exchange,
      segment:contract.segment,instrumentType:contract.instrumentType,
      expiry:contract.expiry,side,quantity:contract.quantity,lots,
      lotSize:contract.lotSize,executionPricePaise:quote.pricePaise,
      quoteTimestampMs:quote.observedAtMs,quoteAgeMs:now-quote.observedAtMs,
      grossPaise:contract.contractValuePaise,charges,chargesPaise:charges.totalChargesPaise,totalDebitPaise:charges.totalDebitPaise,netCreditPaise:charges.netCreditPaise,orderType:"MARKET",
      status:"FILLED",realizedPnlPaise:orderRealizedPnlPaise,
      cashDeltaPaise:fill.cashDeltaPaise,simulationOnly:true,
      excludesCharges:false,createdAt:serverTimestamp()
    };
    tx.create(orderRef,storedOrder);
    tx.update(accountRef,{
      cashPaise,derivativePositions,realizedPnlPaise,reservedMarginPaise:0,
      updatedAt:serverTimestamp(),version:account.version+1
    });
    result={orderId,order:storedOrder,cashPaise,realizedPnlPaise,charges,idempotentReplay:false,simulationOnly:true};
  });
  return result;
}

module.exports={executeLongOptionTransaction,executeLongOptionBuyTransaction:executeLongOptionTransaction,MAX_QUOTE_AGE_MS};
