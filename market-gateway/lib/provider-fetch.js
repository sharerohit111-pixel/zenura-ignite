"use strict";

async function fetchProviderWithTimeout(fetchImpl,url,options={},timeoutMs=15000,timeoutSignal=AbortSignal.timeout){
  try{
    return await fetchImpl(url,{...options,signal:timeoutSignal(timeoutMs)});
  }catch(error){
    if(error?.name==="TimeoutError"||error?.name==="AbortError")throw error;
    throw Object.assign(new Error("Upstream provider request failed."),{status:502,cause:error});
  }
}

module.exports={fetchProviderWithTimeout};
