"use strict";

function canRetryPendingPaperOrder(pendingFingerprint,nextFingerprint){
  return typeof pendingFingerprint === "string" && pendingFingerprint.length > 0
    && pendingFingerprint === nextFingerprint;
}

if(typeof window!=="undefined")window.ZenuraPaperOrderRetryPolicy={canRetryPendingPaperOrder};
if(typeof module!=="undefined"&&module.exports)module.exports={canRetryPendingPaperOrder};
