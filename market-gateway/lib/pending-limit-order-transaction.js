"use strict";

const {buildPaperOrderUpdate}=require("./order-idempotency");
const {evaluatePendingLimitOrder}=require("./pending-limit-order");

function fail(message,status=409){throw Object.assign(new Error(message),{status});}
function accountState(data){
  const positions=data?.positions===undefined?{}:data.positions,reservedPositions=data?.reservedPositions===undefined?{}:data.reservedPositions;
  const reservedCashPaise=data?.reservedCashPaise??0,reservedMarginPaise=data?.reservedMarginPaise??0;
  if(!data||!Number.isSafeInteger(data.cashPaise)||data.cashPaise<0||
    !Number.isSafeInteger(data.realizedPnlPaise??0)||
    !Number.isSafeInteger(reservedCashPaise)||reservedCashPaise<0||
    !Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    reservedCashPaise+reservedMarginPaise>data.cashPaise||
    !positions||typeof positions!=="object"||Array.isArray(positions)||
    (data.positions!==undefined&&(!data.positions||typeof data.positions!=="object"||Array.isArray(data.positions)))||
    !reservedPositions||typeof reservedPositions!=="object"||Array.isArray(reservedPositions)||
    (data.reservedPositions!==undefined&&(!data.reservedPositions||typeof data.reservedPositions!=="object"||Array.isArray(data.reservedPositions))))
    fail("Paper account reservation state is invalid.");
  for(const [key,position] of Object.entries(positions)){
    if(!key||!position||typeof position!=="object"||Array.isArray(position)||
      !Number.isSafeInteger(position.quantity)||position.quantity<0||position.quantity>1000000||
      !Number.isSafeInteger(position.averagePricePaise)||position.averagePricePaise<0||
      (position.quantity>0&&position.averagePricePaise<1))
      fail("Paper account contains a malformed cash-equity position.");
    const legacyCost=position.quantity*position.averagePricePaise;
    const costBasis=position.costBasisPaise===undefined?legacyCost:position.costBasisPaise;
    if(!Number.isSafeInteger(legacyCost)||!Number.isSafeInteger(costBasis)||costBasis<0||
      (position.quantity>0&&costBasis<1)||(position.quantity===0&&costBasis!==0)||
      (position.quantity>0&&Math.round(costBasis/position.quantity)!==position.averagePricePaise))
      fail("Paper account contains an invalid cash-equity cost basis.");
  }
  for(const [key,value] of Object.entries(reservedPositions)){
    if(!key||!Number.isSafeInteger(value)||value<0||value>(positions[key]?.quantity??0))
      fail("Paper account contains invalid reserved share quantities.");
  }
  return {positions,reservedPositions,reservedCashPaise,reservedMarginPaise};
}
function nextVersion(account){
  const version=account.version===undefined?1:account.version;
  if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER)fail("Invalid paper account version.");
  return version+1;
}
function releaseReservation(account,order){
  if(!order||typeof order!=="object"||Array.isArray(order)||
    !["BUY","SELL"].includes(order.side)||typeof order.instrumentKey!=="string"||!order.instrumentKey||
    !Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000||
    !Number.isSafeInteger(order.limitPricePaise)||order.limitPricePaise<1)
    fail("Pending LIMIT order reservation metadata is invalid.");
  const expectedBuyReserve=order.limitPricePaise*order.quantity;
  if(!Number.isSafeInteger(expectedBuyReserve)||expectedBuyReserve<1)
    fail("Pending LIMIT order reservation value is invalid.");
  const state=accountState(account);
  const reservedPositions={...state.reservedPositions};
  let reservedCashPaise=state.reservedCashPaise;
  if(order.side==="BUY"){
    const amount=order.reservedCashPaise;
    if(amount!==expectedBuyReserve||order.reservedQuantity!==0||reservedCashPaise<amount)
      fail("BUY reservation is missing or inconsistent.");
    reservedCashPaise-=amount;
  }else{
    const amount=order.reservedQuantity;
    const current=reservedPositions[order.instrumentKey]??0;
    if(amount!==order.quantity||order.reservedCashPaise!==0||current<amount)
      fail("SELL share reservation is missing or inconsistent.");
    if(current===amount)delete reservedPositions[order.instrumentKey];
    else reservedPositions[order.instrumentKey]=current-amount;
  }
  return {reservedCashPaise,reservedPositions};
}
async function placePendingLimitOrder({db,accountRef,orderRef,uid,order,serverTimestamp}){
  if(!db?.runTransaction||accountRef?.id!==uid||!orderRef||typeof uid!=="string"||!uid||
    order?.uid!==uid||order?.orderType!=="LIMIT"||order?.status!=="PENDING"||
    order?.simulationOnly!==true||!["BUY","SELL"].includes(order?.side)||
    typeof order?.instrumentKey!=="string"||!order.instrumentKey||
    !Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000||
    !Number.isSafeInteger(order.limitPricePaise)||order.limitPricePaise<1||
    typeof serverTimestamp!=="function")throw new TypeError("Invalid pending LIMIT order dependencies or payload.");
  const reserve=order.limitPricePaise*order.quantity;
  if(!Number.isSafeInteger(reserve)||reserve<1)fail("LIMIT order value exceeds supported calculation limits.",400);
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,orderSnap]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(orderSnap.exists){
      const prior=orderSnap.data();
      if(prior?.uid!==uid||prior?.simulationOnly!==true||prior?.orderType!=="LIMIT")
        fail("Stored LIMIT order does not belong to this account.",409);
      if(typeof order.requestFingerprint!=="string"||!order.requestFingerprint||
        prior.requestFingerprint!==order.requestFingerprint)
        fail("Idempotency key was already used for a different LIMIT order.",409);
      result={orderId:orderRef.id,status:prior.status,orderType:"LIMIT",side:prior.side,
        reservedCashPaise:prior.reservedCashPaise??0,reservedQuantity:prior.reservedQuantity??0,
        idempotentReplay:true};
      return;
    }
    if(!accountSnap.exists)fail("Paper account is not initialized.");
    const account=accountSnap.data(),state=accountState(account);
    const patch={updatedAt:serverTimestamp(),version:nextVersion(account)};
    const stored={...order,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    if(order.side==="BUY"){
      if(!(state.positions[order.instrumentKey]?.quantity>0)){
        const openPositions=Object.values(state.positions).filter(position=>position.quantity>0).length;
        if(openPositions>=50)fail("Paper portfolio is limited to 50 open positions.");
      }
      const available=account.cashPaise-state.reservedCashPaise-state.reservedMarginPaise;
      if(available<reserve)fail("Insufficient unreserved virtual cash for this LIMIT BUY.");
      patch.reservedCashPaise=state.reservedCashPaise+reserve;
      stored.reservedCashPaise=reserve;
      stored.reservedQuantity=0;
    }else{
      const position=state.positions[order.instrumentKey];
      const held=position?.quantity??0,already=state.reservedPositions[order.instrumentKey]??0;
      if(!Number.isSafeInteger(held)||held<0||!Number.isSafeInteger(already)||already<0||already>held||held-already<order.quantity)
        fail("Insufficient unreserved shares for this LIMIT SELL.");
      patch.reservedPositions={...state.reservedPositions,[order.instrumentKey]:already+order.quantity};
      stored.reservedCashPaise=0;
      stored.reservedQuantity=order.quantity;
    }
    tx.create(orderRef,stored);
    tx.update(accountRef,patch);
    result={orderId:orderRef.id,status:"PENDING",orderType:"LIMIT",side:order.side,reservedCashPaise:stored.reservedCashPaise,reservedQuantity:stored.reservedQuantity};
  });
  return result;
}
async function cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp}){
  if(!db?.runTransaction||accountRef?.id!==uid||!orderRef||typeof uid!=="string"||!uid||typeof serverTimestamp!=="function")
    throw new TypeError("Invalid LIMIT cancellation dependencies.");
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,orderSnap]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(!orderSnap.exists)fail("LIMIT order was not found.",404);
    const order=orderSnap.data();
    if(order?.uid!==uid||order?.simulationOnly!==true||order?.orderType!=="LIMIT")fail("LIMIT order does not belong to this account.",403);
    if(order.status==="CANCELLED"){result={orderId:orderRef.id,status:"CANCELLED",idempotentReplay:true};return;}
    if(order.status!=="PENDING")fail("Only pending LIMIT orders can be cancelled.");
    if(!accountSnap.exists)fail("Paper account is not initialized.");
    const released=releaseReservation(accountSnap.data(),order);
    const version=nextVersion(accountSnap.data()),now=serverTimestamp();
    tx.update(accountRef,{...released,updatedAt:now,version});
    tx.update(orderRef,{status:"CANCELLED",cancelledAt:now,updatedAt:now,reservationReleased:true});
    result={orderId:orderRef.id,status:"CANCELLED",reservationReleased:true};
  });
  return result;
}
async function executePendingLimitOrder({db,accountRef,orderRef,uid,quote,nowMs=Date.now(),serverTimestamp}){
  if(!db?.runTransaction||accountRef?.id!==uid||!orderRef||typeof uid!=="string"||!uid||typeof serverTimestamp!=="function")
    throw new TypeError("Invalid LIMIT execution dependencies.");
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,orderSnap]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(!orderSnap.exists)fail("LIMIT order was not found.",404);
    const order=orderSnap.data();
    if(order?.uid!==uid||order?.simulationOnly!==true||order?.orderType!=="LIMIT")fail("LIMIT order does not belong to this account.",403);
    if(order.status==="FILLED"){result={orderId:orderRef.id,status:"FILLED",idempotentReplay:true};return;}
    if(order.status!=="PENDING"){result={orderId:orderRef.id,status:order.status,notExecuted:true};return;}
    if(!accountSnap.exists)fail("Paper account is not initialized.");
    const eligibility=evaluatePendingLimitOrder({order,quote,nowMs});
    if(!eligibility.eligible){result={orderId:orderRef.id,status:"PENDING",notExecuted:true,reason:eligibility.reason};return;}
    const account=accountSnap.data(),released=releaseReservation(account,order);
    const working={...account,...released};
    const fill=buildPaperOrderUpdate(working,{instrumentKey:order.instrumentKey,side:order.side,quantity:order.quantity,pricePaise:eligibility.executionPricePaise});
    const now=serverTimestamp();
    tx.update(accountRef,{cashPaise:fill.cashPaise,positions:fill.positions,reservedCashPaise:fill.reservedCashPaise,reservedPositions:fill.reservedPositions,realizedPnlPaise:fill.realizedPnlPaise,updatedAt:now,version:nextVersion(account)});
    tx.update(orderRef,{status:"FILLED",executionPricePaise:eligibility.executionPricePaise,grossPaise:fill.grossPaise,realizedPnlPaise:fill.orderRealizedPnlPaise,quoteTimestampMs:eligibility.quoteTimestampMs,quoteAgeMs:eligibility.quoteAgeMs,filledAt:now,updatedAt:now,reservationReleased:true});
    result={orderId:orderRef.id,status:"FILLED",executionPricePaise:eligibility.executionPricePaise,grossPaise:fill.grossPaise,quoteTimestampMs:eligibility.quoteTimestampMs,quoteAgeMs:eligibility.quoteAgeMs};
  });
  return result;
}
module.exports={placePendingLimitOrder,cancelPendingLimitOrder,executePendingLimitOrder};
