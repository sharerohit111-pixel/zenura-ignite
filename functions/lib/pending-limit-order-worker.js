"use strict";

function invalid(message){throw Object.assign(new Error(message),{status:409});}
function eligible(order,quote,nowMs){
  if(!order||typeof order!=="object"||order.orderType!=="LIMIT"||order.status!=="PENDING"||order.simulationOnly!==true||
    typeof order.uid!=="string"||!order.uid||typeof order.instrumentKey!=="string"||!order.instrumentKey||
    !["BUY","SELL"].includes(order.side)||!Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000||
    !Number.isSafeInteger(order.limitPricePaise)||order.limitPricePaise<1||
    !quote||!Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1||
    !Number.isSafeInteger(quote.timestampMs)||quote.timestampMs<1||
    !Number.isSafeInteger(nowMs)||quote.timestampMs>nowMs||nowMs-quote.timestampMs>15000)return false;
  return order.side==="BUY"?quote.pricePaise<=order.limitPricePaise:quote.pricePaise>=order.limitPricePaise;
}
function sameExecutionIntent(original,current){
  return ["uid","orderType","instrumentKey","side","quantity","limitPricePaise","reservedCashPaise","reservedQuantity"]
    .every(key=>original?.[key]===current?.[key]);
}
function validateAccount(account){
  const positions=account?.positions===undefined?{}:account.positions;
  const reservedPositions=account?.reservedPositions===undefined?{}:account.reservedPositions;
  const reservedCashPaise=account?.reservedCashPaise??0,reservedMarginPaise=account?.reservedMarginPaise??0;
  if(!account||!Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||
    !Number.isSafeInteger(account.realizedPnlPaise??0)||
    !Number.isSafeInteger(reservedCashPaise)||reservedCashPaise<0||
    !Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    reservedCashPaise+reservedMarginPaise>account.cashPaise||
    !positions||typeof positions!=="object"||Array.isArray(positions)||
    (account.positions!==undefined&&(!account.positions||typeof account.positions!=="object"||Array.isArray(account.positions)))||
    !reservedPositions||typeof reservedPositions!=="object"||Array.isArray(reservedPositions)||
    (account.reservedPositions!==undefined&&(!account.reservedPositions||typeof account.reservedPositions!=="object"||Array.isArray(account.reservedPositions))))
    invalid("Paper account reservation state is invalid.");
  for(const [key,position] of Object.entries(positions)){
    if(!key||!position||typeof position!=="object"||Array.isArray(position)||
      !Number.isSafeInteger(position.quantity)||position.quantity<0||position.quantity>1000000||
      !Number.isSafeInteger(position.averagePricePaise)||position.averagePricePaise<0||
      (position.quantity>0&&position.averagePricePaise<1))
      invalid("Paper account contains a malformed cash-equity position.");
    const legacyCost=position.quantity*position.averagePricePaise;
    const costBasis=position.costBasisPaise===undefined?legacyCost:position.costBasisPaise;
    if(!Number.isSafeInteger(legacyCost)||!Number.isSafeInteger(costBasis)||costBasis<0||
      (position.quantity>0&&costBasis<1)||(position.quantity===0&&costBasis!==0)||
      (position.quantity>0&&Math.round(costBasis/position.quantity)!==position.averagePricePaise))
      invalid("Paper account contains an invalid cash-equity cost basis.");
  }
  for(const [key,value] of Object.entries(reservedPositions)){
    if(!key||!Number.isSafeInteger(value)||value<0||value>(positions[key]?.quantity??0))
      invalid("Paper account contains invalid reserved share quantities.");
  }
  return {positions,reservedPositions,reservedCashPaise,reservedMarginPaise};
}
function nextVersion(account){
  const value=account.version===undefined?1:account.version;
  if(!Number.isSafeInteger(value)||value<1||value>=Number.MAX_SAFE_INTEGER)invalid("Invalid paper account version.");
  return value+1;
}
function calculateFill(account,order,pricePaise){
  const state=validateAccount(account),positions={...state.positions},reservedPositions={...state.reservedPositions};
  const grossPaise=pricePaise*order.quantity;
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)invalid("LIMIT execution value is outside safe limits.");
  let reservedCashPaise=state.reservedCashPaise,cashPaise=account.cashPaise;
  let realizedPnlPaise=account.realizedPnlPaise??0,orderRealizedPnlPaise=0;
  const current=positions[order.instrumentKey]||{quantity:0,averagePricePaise:0,costBasisPaise:0};
  const quantity=current.quantity,average=current.averagePricePaise;
  const costBasis=current.costBasisPaise===undefined?quantity*average:current.costBasisPaise;
  if(!Number.isSafeInteger(quantity)||quantity<0||!Number.isSafeInteger(average)||average<0||
    !Number.isSafeInteger(costBasis)||costBasis<0||(quantity>0&&(average<1||costBasis<1||Math.round(costBasis/quantity)!==average)))invalid("Existing paper position is invalid.");
  if(order.side==="BUY"){
    if(!(positions[order.instrumentKey]?.quantity>0)&&Object.values(positions).filter(position=>position?.quantity>0).length>=50)
      invalid("Paper portfolio is limited to 50 open positions.");
    const reserve=order.reservedCashPaise,expectedReserve=order.limitPricePaise*order.quantity;
    if(!Number.isSafeInteger(expectedReserve)||!Number.isSafeInteger(reserve)||reserve!==expectedReserve||
      order.reservedQuantity!==0||reservedCashPaise<reserve)
      invalid("LIMIT BUY cash reservation is inconsistent.");
    reservedCashPaise-=reserve;
    cashPaise-=grossPaise;
    const nextQty=quantity+order.quantity,nextCost=costBasis+grossPaise;
    if(!Number.isSafeInteger(nextQty)||nextQty>1000000||!Number.isSafeInteger(nextCost)||cashPaise<reservedCashPaise+state.reservedMarginPaise)invalid("LIMIT BUY exceeds available virtual account resources.");
    positions[order.instrumentKey]={quantity:nextQty,averagePricePaise:Math.round(nextCost/nextQty),costBasisPaise:nextCost};
  }else if(order.side==="SELL"){
    const reserved=order.reservedQuantity,currentReserved=reservedPositions[order.instrumentKey]??0;
    if(order.reservedCashPaise!==0||!Number.isSafeInteger(reserved)||reserved!==order.quantity||
      currentReserved<reserved||quantity<reserved)invalid("LIMIT SELL share reservation is inconsistent.");
    if(currentReserved===reserved)delete reservedPositions[order.instrumentKey];else reservedPositions[order.instrumentKey]=currentReserved-reserved;
    const allocated=quantity===order.quantity?costBasis:Number((BigInt(costBasis)*BigInt(order.quantity)+BigInt(Math.floor(quantity/2)))/BigInt(quantity));
    const remaining=costBasis-allocated,remainingQty=quantity-order.quantity;
    orderRealizedPnlPaise=grossPaise-allocated;
    realizedPnlPaise+=orderRealizedPnlPaise;cashPaise+=grossPaise;
    if(!Number.isSafeInteger(allocated)||!Number.isSafeInteger(remaining)||!Number.isSafeInteger(realizedPnlPaise)||!Number.isSafeInteger(cashPaise))invalid("LIMIT SELL exceeds safe account limits.");
    if(remainingQty)positions[order.instrumentKey]={quantity:remainingQty,averagePricePaise:Math.round(remaining/remainingQty),costBasisPaise:remaining};
    else delete positions[order.instrumentKey];
  }else invalid("Unsupported LIMIT order side.");
  return {cashPaise,realizedPnlPaise,orderRealizedPnlPaise,grossPaise,positions,reservedCashPaise,reservedPositions};
}
async function execute({db,orderRef,order,quote,nowMs,serverTimestamp}){
  const uid=order?.uid;
  if(typeof uid!=="string"||!uid||order.orderType!=="LIMIT"||order.status!=="PENDING"||order.simulationOnly!==true)return "SKIPPED";
  if(!eligible(order,quote,nowMs))return "NOT_ELIGIBLE";
  const accountRef=db.collection("indianPaperAccounts").doc(uid);
  let outcome="NOT_ELIGIBLE";
  await db.runTransaction(async tx=>{
    outcome="NOT_ELIGIBLE";
    const [accountSnap,orderSnap]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(!orderSnap.exists||!accountSnap.exists)return;
    const currentOrder=orderSnap.data();
    if(currentOrder.uid!==uid||currentOrder.orderType!=="LIMIT"||currentOrder.simulationOnly!==true||!sameExecutionIntent(order,currentOrder))return;
    if(currentOrder.status==="FILLED"){outcome="ALREADY_FILLED";return;}
    if(currentOrder.status!=="PENDING")return;
    const now=Date.now();
    if(!eligible(currentOrder,quote,now))return;
    const account=accountSnap.data(),fill=calculateFill(account,currentOrder,quote.pricePaise),stamp=serverTimestamp();
    const version=nextVersion(account);
    tx.update(accountRef,{cashPaise:fill.cashPaise,realizedPnlPaise:fill.realizedPnlPaise,positions:fill.positions,reservedCashPaise:fill.reservedCashPaise,reservedPositions:fill.reservedPositions,updatedAt:stamp,version});
    tx.update(orderRef,{status:"FILLED",executionPricePaise:quote.pricePaise,grossPaise:fill.grossPaise,realizedPnlPaise:fill.orderRealizedPnlPaise,quoteTimestampMs:quote.timestampMs,quoteAgeMs:Math.max(0,now-quote.timestampMs),filledAt:stamp,updatedAt:stamp,reservationReleased:true,workerExecution:true});
    outcome="FILLED";
  });
  return outcome;
}
async function processPendingLimitOrders({db,fetchQuote,nowMs=Date.now(),serverTimestamp,maxOrders=50,concurrency=5,logger={warn(){},error(){}}}){
  if(!db||typeof fetchQuote!=="function"||typeof serverTimestamp!=="function")throw new TypeError("Pending LIMIT worker dependencies are invalid.");
  if(!Number.isSafeInteger(nowMs)||nowMs<1||!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>100||
    !Number.isInteger(concurrency)||concurrency<1||concurrency>10)throw new TypeError("Pending LIMIT worker bounds are invalid.");
  const ordersCollection=db.collection("indianPaperOrders");
  const baseQuery=ordersCollection.where("orderType","==","LIMIT").where("status","==","PENDING").orderBy("createdAt","asc");
  const cursorRef=db.collection("indianMarketWorkerState").doc("pendingLimitOrders");
  const cursorSnap=await cursorRef.get();
  const cursorId=cursorSnap.exists&&typeof cursorSnap.data()?.cursorOrderId==="string"?cursorSnap.data().cursorOrderId:null;
  let query=baseQuery;
  if(cursorId){
    const lastOrder=await ordersCollection.doc(cursorId).get();
    if(lastOrder.exists)query=query.startAfter(lastOrder);
  }
  let snapshot=await query.limit(maxOrders).get();
  if(snapshot.empty&&cursorId)snapshot=await baseQuery.limit(maxOrders).get();
  const summary={scanned:snapshot.size,filled:0,notEligible:0,failed:0,alreadyFilled:0};
  for(let offset=0;offset<snapshot.docs.length;offset+=concurrency){
    const batch=snapshot.docs.slice(offset,offset+concurrency);
    await Promise.all(batch.map(async doc=>{
      const order=doc.data();
      try{
        const quote=await fetchQuote(order);
        // Quotes are fetched after the scan starts; validate against the post-fetch clock,
        // otherwise a fresh trade timestamp newer than the scan start is rejected as future-dated.
        const quoteNowMs=Math.max(nowMs,Date.now());
        const result=await execute({db,orderRef:doc.ref,order,quote,nowMs:quoteNowMs,serverTimestamp});
        if(result==="FILLED")summary.filled++;
        else if(result==="ALREADY_FILLED")summary.alreadyFilled++;
        else summary.notEligible++;
      }catch(error){
        summary.failed++;
        logger.warn("Pending LIMIT order was not processed",{orderId:doc.id,errorName:error.name||"Error",status:error.status||500});
      }
    }));
  }
  if(snapshot.docs.length){
    await cursorRef.set({cursorOrderId:snapshot.docs[snapshot.docs.length-1].id,updatedAt:serverTimestamp()},{merge:true});
  }else if(cursorId){
    await cursorRef.set({cursorOrderId:null,updatedAt:serverTimestamp()},{merge:true});
  }
  return summary;
}
module.exports={processPendingLimitOrders,executePendingLimitOrderInWorker:execute,eligible};
