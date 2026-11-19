"use strict";

function createSingleFlight(task){
  if(typeof task!=="function")throw new TypeError("A refresh task is required.");
  let pending=null;
  return function runSingleFlight(){
    if(pending)return pending;
    const current=Promise.resolve().then(task);
    pending=current.finally(()=>{if(pending===wrapped)pending=null;});
    const wrapped=pending;
    return pending;
  };
}

module.exports={createSingleFlight};
