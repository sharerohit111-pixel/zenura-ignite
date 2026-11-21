"use strict";

// The scheduled LIMIT worker is inert unless an operator explicitly opts in.
function isPendingLimitWorkerEnabled(env=process.env){
  return env?.ZENURA_ENABLE_PAPER_LIMIT_WORKER==="true";
}

module.exports={isPendingLimitWorkerEnabled};
