"use strict";
function connectionGeneration(data){
  return Number.isSafeInteger(data?.generation)&&data.generation>=0?data.generation:0;
}
function isOAuthGenerationCurrent(controlData,stateGeneration){
  return Number.isSafeInteger(stateGeneration)&&stateGeneration>=0&&connectionGeneration(controlData)===stateGeneration;
}
async function disconnectUpstoxAccount(db,uid,now=Date.now()){
  if(!db||typeof uid!=="string"||!uid||!Number.isSafeInteger(now)||now<0)throw new TypeError("Invalid disconnect request");
  const connectionRef=db.collection("upstoxConnections").doc(uid);
  const leaseRef=db.collection("indianMarketStreamLeases").doc(uid);
  const controlRef=db.collection("upstoxConnectionControls").doc(uid);
  return db.runTransaction(async tx=>{
    const connectionSnap=await tx.get(connectionRef);
    const leaseSnap=await tx.get(leaseRef);
    const controlSnap=await tx.get(controlRef);
    const currentGeneration=connectionGeneration(controlSnap.exists?controlSnap.data():null);
    if(currentGeneration>=Number.MAX_SAFE_INTEGER)throw new RangeError("Connection generation exhausted");
    const generation=currentGeneration+1;
    if(connectionSnap.exists)tx.delete(connectionRef);
    if(leaseSnap.exists)tx.set(leaseRef,{...leaseSnap.data(),revoked:true,updatedAtMs:now});
    tx.set(controlRef,{generation,updatedAtMs:now},{merge:true});
    return {disconnected:true,generation,activeFeedTermination:"requested"};
  });
}
module.exports={disconnectUpstoxAccount,isOAuthGenerationCurrent,connectionGeneration};
