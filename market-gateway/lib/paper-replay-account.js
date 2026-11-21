"use strict";

function readReplayAccountState(snapshot){
  if(!snapshot||snapshot.exists!==true||typeof snapshot.data!=="function"){
    const error=new Error("Paper account is not initialized.");
    error.status=409;
    throw error;
  }
  const data=snapshot.data();
  const realizedPnlPaise=data?.realizedPnlPaise??0;
  if(!data||!Number.isSafeInteger(data.cashPaise)||data.cashPaise<0||!Number.isSafeInteger(realizedPnlPaise)){
    const error=new Error("Paper account contains invalid balance data.");
    error.status=409;
    throw error;
  }
  return {cashPaise:data.cashPaise,realizedPnlPaise};
}

module.exports={readReplayAccountState};
